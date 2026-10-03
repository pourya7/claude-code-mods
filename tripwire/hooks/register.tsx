import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Hits, TripwireArmedRule, TripwireProposal, TripwireSprung } from '../types'
import { COMPILE_SYSTEM, buildCompilePrompt, parseProposal, uniqueId } from './compile'
import { argumentsOf, evaluate, mergeRules, parseRuleFile, rawRulesOf } from './rules'
import type { ParsedRules, Rule, RuleSource } from './rules'
import { ARMED_SPRITE, PICO8, TRAP_SPRITE, spriteRuns } from './sprite'
import { STARTER_RULES } from './starter'
import { askReason, clockText, hitsOf, noteText, recordHits, rewriteText, statusText, trapText } from './text'

type Engine = EngineInterface

const PANE = 'tripwire'
const HITS_KEY = 'hits'

const RULES = { plugin: 'tripwire', key: 'rules' } as const
const rulesAtom = atom(RULES, [])
const PROBLEMS = { plugin: 'tripwire', key: 'problems' } as const
const problemsAtom = atom(PROBLEMS, [])
const DISARMED = { plugin: 'tripwire', key: 'disarmed' } as const
const disarmedAtom = atom(DISARMED, [])
const HITS = { plugin: 'tripwire', key: 'hits' } as const
const hitsAtom = atom(HITS, {})
const SPRUNG = { plugin: 'tripwire', key: 'sprung' } as const
const sprungAtom = atom(SPRUNG, null)
const PROPOSAL = { plugin: 'tripwire', key: 'proposal' } as const
const proposalAtom = atom(PROPOSAL, null)
const NOTICE = { plugin: 'tripwire', key: 'notice' } as const
const noticeAtom = atom(NOTICE, null)

const ACTION_COLOR: Record<Rule['action'], string> = {
  deny: PICO8.r,
  ask: PICO8.o,
  rewrite: PICO8.u,
  note: PICO8.y,
}

const USAGE = [
  'usage: /tripwire                  open the TRAPS ARMED pane',
  '       /tripwire list             list the rules as text',
  '       /tripwire reload           re-read ~/.claude/tripwire.json and <project>/.claude/tripwire.json',
  '       /tripwire add <sentence>   propose a rule from plain English (you press ARM)',
  '       /tripwire init             write the starter pack to ~/.claude/tripwire.json if it is missing',
].join('\n')

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const armedCount = (rules: readonly TripwireArmedRule[], disarmed: readonly string[]) =>
  rules.filter(rule => !disarmed.includes(rule.id)).length

const proposalText = (proposal: TripwireProposal) =>
  'rule' in proposal
    ? `PROPOSED RULE for "${proposal.sentence}":\n${JSON.stringify(proposal.rule, null, 2)}\nPress ARM in the /tripwire pane to append it to ~/.claude/tripwire.json, or DISCARD. Nothing is written until you do.`
    : `COULD NOT COMPILE "${proposal.sentence}": ${proposal.reason}. Nothing was armed.`

// ── files ────────────────────────────────────────────────────────────────

const userFile = async ($: Engine): Promise<string | undefined> => {
  const home = await $.env.get('HOME')
  return home ? `${home}/.claude/tripwire.json` : undefined
}

const projectFile = async ($: Engine): Promise<string | undefined> => {
  const root = await $.session.root().catch(() => undefined)
  return root ? `${root}/.claude/tripwire.json` : undefined
}

const readRuleFile = async ($: Engine, path: string | undefined, source: RuleSource): Promise<ParsedRules> => {
  if (path === undefined) return { rules: [], problems: [] }
  try {
    if (!(await $.fs.exists(path))) return { rules: [], problems: [] }
    return parseRuleFile(await $.fs.read(path), source)
  } catch (error) {
    return { rules: [], problems: [`${source} file could not be read: ${errorText(error)}`] }
  }
}

// ── session state ────────────────────────────────────────────────────────

const title = async ($: Engine) =>
  `TRAPS ARMED: ${armedCount(await read($, rulesAtom), await read($, disarmedAtom))}`

const showStatus = async ($: Engine) => {
  const rules = await read($, rulesAtom)
  const bad = (await read($, problemsAtom)).length
  $.ui.status(statusText(armedCount(rules, await read($, disarmedAtom)), bad))
}

/** Reads both files, keeps the good rules, and reports the bad ones in one toast. */
const loadRules = async ($: Engine) => {
  const merged = mergeRules([
    await readRuleFile($, await userFile($), 'user'),
    await readRuleFile($, await projectFile($), 'project'),
  ])
  await $.state.set(RULES, merged.rules)
  await $.state.set(PROBLEMS, merged.problems)
  try {
    const stored = hitsOf(await $.store.get(HITS_KEY))
    if (stored !== undefined) await $.state.set(HITS, stored)
  } catch {
    // A store that cannot be read leaves the session's counts as they are.
  }
  const bad = merged.problems.length
  if (bad > 0) $.ui.toast(`TRIPWIRE: ${bad} BAD RULE${bad === 1 ? '' : 'S'} SKIPPED · /tripwire`)
  await showStatus($)
}

/**
 * Adds this call's hits to the counts in the store as they are now, not as
 * this session last read them, so concurrent sessions add up instead of
 * overwriting each other. The session's atom mirrors the merged map.
 */
const countHits = async ($: Engine, rules: readonly Rule[]) => {
  try {
    const now = await $.clock.now()
    const ids = rules.map(rule => rule.id)
    let base: Hits | undefined
    try {
      base = hitsOf(await $.store.get(HITS_KEY))
    } catch {
      base = undefined
    }
    const hits = recordHits(base ?? (await read($, hitsAtom)), ids, now)
    await $.state.set(HITS, hits)
    await $.store.set(HITS_KEY, hits)
  } catch {
    // Counting is best effort: a failed write never blocks enforcement.
  }
}

const listText = async ($: Engine): Promise<string> => {
  const rules = await read($, rulesAtom)
  const disarmed = await read($, disarmedAtom)
  const hits = await read($, hitsAtom)
  const problems = await read($, problemsAtom)
  const lines = [await title($)]
  if (rules.length === 0) lines.push('  no rules yet: /tripwire init writes the starter pack')
  for (const rule of rules) {
    const hit = hits[rule.id]
    const state = disarmed.includes(rule.id) ? 'DISARMED' : rule.action.toUpperCase()
    lines.push(`  ${rule.id}  ${state}  x${hit?.count ?? 0}  ${clockText(hit?.lastHit)}  (${rule.source})`)
  }
  if (problems.length > 0) {
    lines.push('BAD RULES (skipped):')
    for (const problem of problems) lines.push(`  ${problem}`)
  }
  return lines.join('\n')
}

const openPane = async ($: Engine) => {
  try {
    await $.ui.open({ id: PANE, title: await title($) })
  } catch {
    // No surface places panes (a -p run): the command's text reply stands.
  }
}

// ── actions ──────────────────────────────────────────────────────────────

const toggleRule = async ($: Engine, id: string) => {
  await update($, disarmedAtom, list => (list.includes(id) ? list.filter(one => one !== id) : [...list, id]))
  await openPane($)
  await showStatus($)
}

/** The human's ARM: append the proposed rule to the user file, then reload. */
const armProposal = async ($: Engine) => {
  const proposal = await read($, proposalAtom)
  if (proposal === null || !('rule' in proposal)) return
  const path = await userFile($)
  if (path === undefined) {
    await $.state.set(NOTICE, 'HOME is not set: nothing written.')
    return
  }
  try {
    let data: unknown = { rules: [] }
    if (await $.fs.exists(path)) data = JSON.parse(await $.fs.read(path))
    const existing = rawRulesOf(data)
    if (existing === undefined) {
      await $.state.set(NOTICE, `${path} is not a rule list: fix it first. Nothing written.`)
      return
    }
    const taken = [
      ...existing.map(raw => String((raw as { id?: unknown } | null)?.id ?? '')),
      ...(await read($, rulesAtom)).map(rule => rule.id),
    ]
    const rule = { ...proposal.rule, id: uniqueId(proposal.rule.id, taken) }
    const next = Array.isArray(data) ? [...data, rule] : { ...(data as object), rules: [...existing, rule] }
    await $.fs.write(path, `${JSON.stringify(next, null, 2)}\n`)
    await $.state.set(PROPOSAL, null)
    await $.state.set(NOTICE, `ARMED ${rule.id} → ${path}`)
    await loadRules($)
    await openPane($)
  } catch (error) {
    await $.state.set(NOTICE, `Could not arm: ${errorText(error)}. Nothing written.`)
  }
}

const discardProposal = async ($: Engine) => {
  await $.state.set(PROPOSAL, null)
  await $.state.set(NOTICE, 'DISCARDED. Nothing written.')
}

/** The model only proposes; this never writes. */
const compile = async ($: Engine, sentence: string, compileModel: string): Promise<TripwireProposal> => {
  try {
    const reply = await $.model.complete({
      model: compileModel,
      system: COMPILE_SYSTEM,
      prompt: buildCompilePrompt(sentence),
      maxTokens: 800,
      timeoutMs: 60000,
    })
    if (!reply.isAnswered) return { sentence, reason: `the model call failed (${reply.reason})` }
    const parsed = parseProposal(reply.text)
    return 'rule' in parsed ? { sentence, rule: parsed.rule } : { sentence, reason: parsed.reason }
  } catch (error) {
    return { sentence, reason: `the model call was refused (${errorText(error)})` }
  }
}

const init = async ($: Engine): Promise<string> => {
  const path = await userFile($)
  if (path === undefined) return 'HOME is not set: nothing written.'
  try {
    if (await $.fs.exists(path)) {
      return `${path} already exists: nothing written. The starter pack is in the plugin's examples/tripwire.json to copy from.`
    }
    await $.fs.write(path, `${JSON.stringify({ rules: STARTER_RULES }, null, 2)}\n`)
  } catch (error) {
    return `Could not write ${path}: ${errorText(error)}`
  }
  await loadRules($)
  return `Wrote the starter pack to ${path}.\n${await listText($)}`
}

export const register: Register = (on, options) => {
  const compileModel =
    typeof options.compileModel === 'string' && options.compileModel !== '' ? options.compileModel : 'haiku'
  const isBandOn = options.band !== false

  // ── events ───────────────────────────────────────────────────────────────

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'tripwire',
        description: 'Show the armed rules; add, reload or init them',
        argumentHint: '[list | reload | add <sentence> | init]',
      })
      await loadRules($)
    } catch (error) {
      $.ui.toast(`TRIPWIRE: could not start (${errorText(error)})`)
    }
    return next(e)
  })

  on('command.run', { command: 'tripwire' }, async ($, e) => {
    const args = e.args.trim()
    const [verb = '', ...rest] = args.split(/\s+/)
    const sentence = rest.join(' ').trim()
    switch (verb.toLowerCase()) {
      case '':
        await openPane($)
        return { text: await listText($) }
      case 'list':
        return { text: await listText($) }
      case 'reload':
        await loadRules($)
        await $.state.set(NOTICE, 'RELOADED')
        return { text: await listText($) }
      case 'init':
        return { text: await init($) }
      case 'add': {
        if (sentence === '') return { text: 'Say the rule: /tripwire add <sentence>' }
        const proposal = await compile($, sentence, compileModel)
        await $.state.set(PROPOSAL, proposal)
        await $.state.set(NOTICE, null)
        await openPane($)
        return { text: proposalText(proposal) }
      }
      default:
        return { text: USAGE }
    }
  })

  on('tool.call', async ($, e, next) => {
    let outcome: ReturnType<typeof evaluate>
    try {
      const rules = await read($, rulesAtom)
      if (rules.length === 0) return next(e)
      const disarmed = await read($, disarmedAtom)
      outcome = evaluate(rules, disarmed, e.tool, argumentsOf(e as unknown as Record<string, unknown>))
    } catch {
      return next(e)
    }
    if (outcome.hits.length > 0) await countHits($, outcome.hits)
    if (outcome.deny !== undefined) {
      const rule = outcome.deny
      try {
        const sprung: TripwireSprung = { id: rule.id, message: rule.message, tool: e.tool, at: await $.clock.now() }
        if (rule.cite) sprung.cite = rule.cite
        await $.state.set(SPRUNG, sprung)
        if (!isBandOn) $.ui.toast(`TRAP SPRUNG! ${rule.id}`)
      } catch {
        // The band is decoration; the deny below is the enforcement.
      }
      return { deny: trapText(rule) }
    }
    const ran = await next(outcome.isChanged ? ({ ...e, ...outcome.input } as typeof e) : e)
    // A rewrite is never silent: the model learns what it actually ran.
    const rewrites = outcome.rewrites.map(rewriteText)
    if (rewrites.length > 0) $.ui.toast(`TRIPWIRE REWROTE ${e.tool.toUpperCase()}: ${outcome.rewrites.map(one => one.rule.id).join(', ')}`)
    if (ran.deny !== undefined) return rewrites.length > 0 ? { deny: [ran.deny, ...rewrites].join('\n') } : ran
    const context = [...rewrites, ...outcome.notes.map(noteText)]
    if (context.length === 0) return ran
    return { ...ran, context: [...(ran.context ?? []), ...context] } as typeof ran
  })

  on('tool.check', async ($, e, next) => {
    const decided = await next(e)
    if (decided.decision === 'deny') return decided
    try {
      const input = e.input
      if (typeof input !== 'object' || input === null) return decided
      const rules = await read($, rulesAtom)
      const disarmed = await read($, disarmedAtom)
      const asks = evaluate(rules, disarmed, e.tool, input as Record<string, unknown>).asks
      return asks.length > 0 ? { decision: 'ask', reason: askReason(asks) } : decided
    } catch {
      return decided
    }
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      if ((await read($, sprungAtom)) !== null) await $.state.set(SPRUNG, null)
    } catch {
      // Leaving the band up is harmless.
    }
    return next(e)
  })

  // ── drawing ──────────────────────────────────────────────────────────────

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const sprung = await read($, sprungAtom)
    if (!isBandOn || sprung === null || e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const sprite = spriteRuns(TRAP_SPRITE)
    return (
      <Box flexDirection="row" gap={2}>
        <Box flexDirection="column">
          {sprite.map((row, y) => (
            <Box key={`trap-row-${y}`} flexDirection="row">
              {row.map(run => (
                <Text color={run.color} backgroundColor={run.backgroundColor}>
                  {run.text}
                </Text>
              ))}
            </Box>
          ))}
        </Box>
        <Box flexDirection="column" flexShrink={1}>
          <Box flexDirection="row" gap={1}>
            <Text bold color={PICO8.w} backgroundColor={PICO8.r}>
              {' TRAP SPRUNG! '}
            </Text>
            <Text bold color={PICO8.r}>
              {sprung.id.toUpperCase()}
            </Text>
            <Text color={PICO8.l}>{`· ${sprung.tool.toUpperCase()} BLOCKED`}</Text>
          </Box>
          <Text color={PICO8.w} wrap="truncate-end">
            {sprung.message}
          </Text>
          {sprung.cite ? (
            <Text color={PICO8.v} wrap="truncate-end">{`CITE ${sprung.cite}`}</Text>
          ) : (
            <Text color={PICO8.d}>NO CITE</Text>
          )}
          <Box flexDirection="row">
            <Button key="tripwire-ok" label="OK" role="dismiss" onPress={() => $.state.set(SPRUNG, null)} />
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const rules = await read($, rulesAtom)
    const disarmed = await read($, disarmedAtom)
    const hits = await read($, hitsAtom)
    const problems = await read($, problemsAtom)
    const proposal = await read($, proposalAtom)
    const notice = await read($, noticeAtom)
    const width = Math.max(24, e.props.bodyColumns)
    const idWidth = Math.min(28, Math.max(8, ...rules.map(rule => rule.id.length)))
    const armed = armedCount(rules, disarmed)
    const icon = spriteRuns(ARMED_SPRITE)
    const userCount = rules.filter(rule => rule.source === 'user').length

    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row" gap={1}>
          <Box flexDirection="column">
            {icon.map((row, y) => (
              <Box key={`icon-row-${y}`} flexDirection="row">
                {row.map(run => (
                  <Text color={run.color} backgroundColor={run.backgroundColor}>
                    {run.text}
                  </Text>
                ))}
              </Box>
            ))}
          </Box>
          <Box flexDirection="column">
            <Text bold color={PICO8.r}>{`TRAPS ARMED: ${armed}`}</Text>
            <Text color={PICO8.l}>
              {`${userCount} USER · ${rules.length - userCount} PROJECT · ${rules.length - armed} DISARMED`}
            </Text>
          </Box>
        </Box>
        <Text color={PICO8.d}>{'─'.repeat(Math.min(width, 60))}</Text>
        {rules.length === 0 && <Text color={PICO8.l}>NO TRAPS. /tripwire init WRITES THE STARTER PACK.</Text>}
        {rules.map(rule => {
          const isOff = disarmed.includes(rule.id)
          const hit = hits[rule.id]
          return (
            <Box key={`rule-${rule.id}`} flexDirection="row" gap={1}>
              <Text color={isOff ? PICO8.d : ACTION_COLOR[rule.action]}>{isOff ? '○' : '●'}</Text>
              <Text color={isOff ? PICO8.d : PICO8.w} wrap="truncate-end">
                {rule.id.toUpperCase().padEnd(idWidth).slice(0, idWidth)}
              </Text>
              <Text color={isOff ? PICO8.d : ACTION_COLOR[rule.action]}>
                {(isOff ? 'OFF' : rule.action.toUpperCase()).padEnd(7)}
              </Text>
              <Text color={PICO8.y}>{`x${hit?.count ?? 0}`.padStart(4)}</Text>
              <Text color={PICO8.l}>{clockText(hit?.lastHit)}</Text>
              <Button
                key={`disarm-${rule.id}`}
                label={isOff ? 'REARM' : 'DISARM'}
                onPress={() => toggleRule($, rule.id)}
              />
            </Box>
          )
        })}
        {problems.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color={PICO8.o}>{`BAD RULES SKIPPED: ${problems.length}`}</Text>
            {problems.map(problem => (
              <Text color={PICO8.o} wrap="truncate-end">{`✕ ${problem}`}</Text>
            ))}
          </Box>
        )}
        {proposal !== null && 'rule' in proposal && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color={PICO8.y}>{'PROPOSED RULE · NOT ARMED'}</Text>
            <Text color={PICO8.l} wrap="truncate-end">{`"${proposal.sentence}"`}</Text>
            {JSON.stringify(proposal.rule, null, 2)
              .split('\n')
              .map(line => (
                <Text color={PICO8.w} wrap="truncate-end">
                  {line}
                </Text>
              ))}
            <Box flexDirection="row" gap={1}>
              <Button key="tripwire-arm" label="ARM" variant="primary" onPress={() => armProposal($)} />
              <Button key="tripwire-discard" label="DISCARD" onPress={() => discardProposal($)} />
            </Box>
          </Box>
        )}
        {proposal !== null && 'reason' in proposal && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color={PICO8.r}>{'COULD NOT COMPILE · NOTHING ARMED'}</Text>
            <Text color={PICO8.l} wrap="truncate-end">{`"${proposal.sentence}"`}</Text>
            <Text color={PICO8.o}>{proposal.reason}</Text>
            <Box flexDirection="row">
              <Button key="tripwire-discard" label="DISCARD" onPress={() => discardProposal($)} />
            </Box>
          </Box>
        )}
        {notice !== null && (
          <Text color={PICO8.i} wrap="truncate-end">
            {`▶ ${notice}`}
          </Text>
        )}
      </Box>
    )
  })
}
