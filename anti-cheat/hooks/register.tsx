import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AntiCheatEntry, AntiCheatFoul } from '../types'
import { analyzeCommand } from './classify'
import { detectClaims } from './claims'
import { appendEntry, challengeText, foulLine, unverifiedClaims } from './evidence'
import type { NewEntry } from './evidence'
import { PICO8, spriteRows } from './sprite'

const log = atom({ plugin: 'anti-cheat', key: 'log' } as const, [] as AntiCheatEntry[])
const fouls = atom({ plugin: 'anti-cheat', key: 'fouls' } as const, [] as AntiCheatFoul[])
const isChallenging = atom({ plugin: 'anti-cheat', key: 'isChallenging' } as const, false)

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** Prompt origins that are a person's own message. */
const USER_ORIGINS = new Set(['composer', 'bridge', 'sdk'])

/** Fouls shown at once; the rest collapse into one "+N MORE" line. */
const SHOWN_FOULS = 3

/** The referee's penalty flag: red and yellow cloth on a grey pole, lime turf. */
const FLAG = ['grryyr..', 'grryyrr.', 'gyyrryy.', 'gyyrry..', 'g.......', 'g.......', 'g.......', 'lll.....']
const FLAG_PALETTE = { g: PICO8.lightGrey, r: PICO8.red, y: PICO8.yellow, l: PICO8.lime }
const FLAG_ROWS = spriteRows(FLAG, FLAG_PALETTE)

export const register: Register = (on, options) => {
  const mode = options.mode === 'challenge' ? 'challenge' : 'flag'

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'anti-cheat', description: 'Show what anti-cheat has seen run since the last edit' })
    return started
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const isMainLoop = e.agentId === undefined
    const isDone = ran.deny === undefined && ran.isError !== true

    // An edit from any agent, subagents included, makes earlier evidence stale.
    if (EDIT_TOOLS.has(e.tool) && isDone) {
      const input = e as { file_path?: unknown; notebook_path?: unknown }
      const path = String(input.file_path ?? input.notebook_path ?? '')
      await update($, log, entries => appendEntry(entries ?? [], { type: 'edit', path }))
    }

    // Only the main loop's own runs back the main loop's claims.
    if (isMainLoop && e.tool === 'Bash' && ran.deny === undefined) {
      const command = String((e as { command?: unknown }).command ?? '')
      const { checks, status } = analyzeCommand(command)
      if (checks.length > 0) {
        const result = (ran.result ?? {}) as { interrupted?: boolean; backgroundTaskId?: string }
        const runNote = result.backgroundTaskId !== undefined ? 'background' : result.interrupted === true ? 'interrupted' : undefined
        // One entry per way the kinds report: those whose exit status is the
        // result, then those hidden by a pipe or later command, then CI reads.
        const groups = (['exit', 'masked', 'read'] as const)
          .map(how => ({ how, kinds: checks.filter(check => status[check] === how) }))
          .filter(group => group.kinds.length > 0)
        const added: NewEntry[] = groups.map(({ how, kinds }) => {
          const note = runNote ?? (how === 'exit' ? undefined : how)
          return { type: 'run', checks: kinds, command, isOk: isDone && note === undefined, ...(note === undefined ? {} : { note }) }
        })
        await update($, log, entries => added.reduce<AntiCheatEntry[]>((all, entry) => appendEntry(all, entry), entries ?? []))
      }
    }

    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    // Only a prompt a person sent re-arms the auto-challenge: never this mod's
    // own, a background task's notification, a schedule or another plugin.
    if (USER_ORIGINS.has(e.origin?.kind ?? '')) await update($, isChallenging, () => false)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await update($, fouls, () => [])
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return completed

    const found = unverifiedClaims(detectClaims(e.answer), await read($, log))
    if (found.length === 0) return completed

    await update($, fouls, () => found)
    // The notice keeps the foul in the transcript; where the session refuses
    // a plugin's row (or a test kit has none), a toast carries the same line.
    try {
      const appended = await $.session.append({
        message: { type: 'system', content: [{ type: 'text', text: found.map(foul => `anti-cheat ${foulLine(foul)}`).join('\n') }] },
      })
      if (appended.deny !== undefined) throw new Error(appended.deny)
    } catch {
      const more = found.length > 1 ? ` (+${found.length - 1} more)` : ''
      $.ui.toast(`${foulLine(found[0]!)}${more}`)
    }

    if (mode === 'challenge' && !(await read($, isChallenging))) {
      await update($, isChallenging, () => true)
      $.prompt.submit({ text: challengeText(found) }).catch(() => $.ui.toast('could not send the challenge'))
    }

    return completed
  })

  on('command.run', { command: 'anti-cheat' }, async $ => {
    const entries = await read($, log)
    const current = await read($, fouls)
    const lastEdit = [...entries].reverse().find(entry => entry.type === 'edit')
    const runs = entries.filter(entry => entry.type === 'run' && entry.seq > (lastEdit?.seq ?? 0))
    const lines = [
      `ANTI-CHEAT · mode ${mode}`,
      lastEdit?.type === 'edit' ? `last edit: ${lastEdit.path}` : 'no edits this session',
      runs.length === 0
        ? 'no checks ran since'
        : `checks since: ${runs.map(entry => (entry.type === 'run' ? `${entry.isOk ? '✓' : entry.note === undefined ? '✗' : '?'} ${entry.command}` : '')).join(', ')}`,
      ...current.map(foulLine),
    ]
    return { text: lines.join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, fouls)
    if (e.props.hasSurvey || current.length === 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const hidden = current.length - SHOWN_FOULS

    const challenge = async () => {
      const shown = await read($, fouls)
      await update($, fouls, () => [])
      if (shown.length > 0) await $.prompt.submit({ text: challengeText(shown) })
    }
    const dismiss = () => update($, fouls, () => [])

    return (
      <Box key="anti-cheat" flexDirection="row">
        <Box flexDirection="column" marginRight={1}>
          {FLAG_ROWS.map((runs, row) => (
            <Box key={`flag-${row}`} flexDirection="row">
              {runs.map((run, index) => (
                <Text key={`flag-${row}-${index}`} color={run.color} backgroundColor={run.backgroundColor}>
                  {run.text}
                </Text>
              ))}
            </Box>
          ))}
        </Box>
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text key="title" bold color={PICO8.red}>
              FOUL!
            </Text>
            <Text key="subtitle" color={PICO8.lime}>
              {' '}REFEREE REVIEW · {current.length} UNVERIFIED CLAIM{current.length === 1 ? '' : 'S'}
            </Text>
          </Box>
          {current.slice(0, SHOWN_FOULS).map((foul, index) => (
            <Text key={`foul-${index}`} color={PICO8.white} wrap="truncate-end">
              {foulLine(foul)}
            </Text>
          ))}
          {hidden > 0 ? (
            <Text key="more" color={PICO8.lightGrey}>
              +{hidden} MORE
            </Text>
          ) : null}
          <Box flexDirection="row" gap={1}>
            <Button key="challenge" label="CHALLENGE" hotkey="c" variant="primary" onPress={challenge} />
            <Button key="ok" label="OK" hotkey="o" role="dismiss" onPress={dismiss} />
          </Box>
        </Box>
      </Box>
    )
  })
}
