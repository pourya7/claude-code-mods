import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MenderRepairEntry, MenderSchema, MenderToolErrors } from '../types'
import { applyFacts, downReason, factsFrom, isSchemaError, overlayLearned, serverOf } from './learn'
import { DOWN_SOCK_SPRITE, PICO8, SOCK_SPRITE, spriteRuns } from './pixels'
import { parseSchemaFile, repairArguments } from './schema'
import type { JsonSchema, Repair } from './schema'
import { clockText, downNote, learnedNote, oneLine, repairLine, repairNote, shortTool, statusText } from './text'

type Engine = EngineInterface

const PANE = 'mender'
const LEARNED_KEY = 'learned'
const MAX_LOG = 30
const DEFAULT_SCHEMA_FILE = '~/.claude/mender/schemas.json'
/** The keys a tool.call envelope carries beside the tool's own arguments. */
const ENVELOPE = new Set(['tool', 'tool_use_id', 'agentId', 'consent'])

const REPAIRS = { plugin: 'mender', key: 'repairs' } as const
const repairsAtom = atom(REPAIRS, [])
const FIXED = { plugin: 'mender', key: 'fixed' } as const
const fixedAtom = atom(FIXED, 0)
const ERRORS = { plugin: 'mender', key: 'errors' } as const
const errorsAtom = atom(ERRORS, {})
const DOWN = { plugin: 'mender', key: 'down' } as const
const downAtom = atom(DOWN, {})
const SCHEMAS = { plugin: 'mender', key: 'schemas' } as const
const schemasAtom = atom(SCHEMAS, {})
const SCHEMA_PROBLEM = { plugin: 'mender', key: 'schemaProblem' } as const
const schemaProblemAtom = atom(SCHEMA_PROBLEM, '')
const LEARNED = { plugin: 'mender', key: 'learned' } as const
const learnedAtom = atom(LEARNED, {})
const IS_OFF = { plugin: 'mender', key: 'isOff' } as const
const offAtom = atom(IS_OFF, false)

const USAGE = [
  'usage: /mender                 open the PATCH LOG pane',
  '       /mender list            the same, as text',
  '       /mender reload          re-read the schema file',
  '       /mender forget [tool]   forget the shapes learned from errors (all, or one tool)',
  '       /mender off | on        stop or resume mender for this session (off: a pure pass-through)',
].join('\n')

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const learnedOf = (value: unknown): Record<string, MenderSchema> => (isRecord(value) ? (value as Record<string, MenderSchema>) : {})

const sumErrors = (errors: Record<string, MenderToolErrors>) =>
  Object.values(errors).reduce((total, entry) => total + entry.count, 0)

// ── state ────────────────────────────────────────────────────────────────

const showStatus = async ($: Engine) => {
  try {
    $.ui.status(
      statusText({
        fixed: await read($, fixedAtom),
        errors: sumErrors(await read($, errorsAtom)),
        down: Object.keys(await read($, downAtom)).length,
      }),
    )
  } catch {
    // The status line is decoration.
  }
}

const schemaPath = async ($: Engine, configured: string): Promise<string | undefined> => {
  const path = configured.trim() === '' ? DEFAULT_SCHEMA_FILE : configured.trim()
  if (!path.startsWith('~')) return path
  const home = await $.env.get('HOME')
  return home ? `${home}${path.slice(1)}` : undefined
}

/** Reads the schema file (absent is fine) and the learned shapes from the store. */
const load = async ($: Engine, configured: string) => {
  let schemas: Record<string, JsonSchema> = {}
  let problem = ''
  const path = await schemaPath($, configured)
  try {
    if (path !== undefined && (await $.fs.exists(path))) {
      const parsed = parseSchemaFile(await $.fs.read(path))
      schemas = parsed.schemas
      if (parsed.problems.length > 0) problem = `${path}: ${parsed.problems.join('; ')}`
    }
  } catch (error) {
    problem = `${path}: could not be read (${errorText(error)})`
  }
  await $.state.set(SCHEMAS, schemas as Record<string, MenderSchema>)
  await $.state.set(SCHEMA_PROBLEM, problem)
  if (problem !== '') $.ui.toast('MENDER ▸ SCHEMA FILE HAS PROBLEMS · /mender')
  try {
    await $.state.set(LEARNED, learnedOf(await $.store.get(LEARNED_KEY)))
  } catch {
    // A store that cannot be read leaves the session's shapes as they are.
  }
  await showStatus($)
}

/** The file's schema with what the tool's own errors taught laid over it (either alone when only one exists). */
const combine = (file: JsonSchema | undefined, learned: JsonSchema | undefined): JsonSchema | undefined =>
  file === undefined ? learned : learned === undefined ? file : overlayLearned(file, learned)

const schemaFor = async ($: Engine, tool: string): Promise<JsonSchema | undefined> =>
  combine((await read($, schemasAtom))[tool] as JsonSchema | undefined, (await read($, learnedAtom))[tool] as JsonSchema | undefined)

/** Folds new facts into the stored shapes as they are now, so parallel sessions add up. */
const learn = async ($: Engine, tool: string, text: string): Promise<JsonSchema | undefined> => {
  const facts = factsFrom(text)
  if (facts.length === 0) return undefined
  let base = await read($, learnedAtom)
  try {
    base = { ...base, ...learnedOf(await $.store.get(LEARNED_KEY)) }
  } catch {
    // Fall back to the session's copy.
  }
  const schema = applyFacts(base[tool] as JsonSchema | undefined, facts)
  const learned = { ...base, [tool]: schema as MenderSchema }
  await $.state.set(LEARNED, learned)
  try {
    await $.store.set(LEARNED_KEY, learned)
  } catch {
    // Kept for the session at least.
  }
  return schema
}

const recordRepair = async ($: Engine, tool: string, repairs: Repair[]) => {
  const entry: MenderRepairEntry = { at: await $.clock.now(), tool, repairs }
  await update($, repairsAtom, log => [...log, entry].slice(-MAX_LOG))
  await update($, fixedAtom, count => count + 1)
}

const recordError = async ($: Engine, tool: string, text: string) => {
  const now = await $.clock.now()
  await update($, errorsAtom, errors => ({
    ...errors,
    [tool]: { count: (errors[tool]?.count ?? 0) + 1, lastAt: now, last: oneLine(text, 160) },
  }))
}

/** Marks a server down; true when it was not down already (toast once). */
const markDown = async ($: Engine, server: string, reason: string): Promise<boolean> => {
  let isNew = false as boolean
  await update($, downAtom, down => {
    isNew = !(server in down)
    return isNew ? { ...down, [server]: reason } : down
  })
  return isNew
}

/** A call to the server worked: it is back. True when it was marked down. */
const clearDown = async ($: Engine, server: string): Promise<boolean> => {
  if (!(server in (await read($, downAtom)))) return false
  await update($, downAtom, down => {
    const { [server]: _gone, ...rest } = down
    return rest
  })
  return true
}

// ── text ─────────────────────────────────────────────────────────────────

const listText = async ($: Engine): Promise<string> => {
  const repairs = await read($, repairsAtom)
  const errors = await read($, errorsAtom)
  const down = await read($, downAtom)
  const schemas = Object.keys(await read($, schemasAtom)).length
  const learned = Object.keys(await read($, learnedAtom)).length
  const problem = await read($, schemaProblemAtom)
  const lines = [
    `MENDER${(await read($, offAtom)) ? ' (OFF)' : ''} · ${await read($, fixedAtom)} calls fixed · ${schemas} tools from the schema file · ${learned} learned from errors`,
  ]
  if (problem !== '') lines.push(`schema file problem: ${problem}`)
  for (const [server, reason] of Object.entries(down)) lines.push(`DOWN ${server}: ${reason}`)
  lines.push('REPAIRS')
  if (repairs.length === 0) lines.push('  none yet')
  for (const entry of repairs.slice(-10)) {
    for (const repair of entry.repairs) lines.push(`  ${clockText(entry.at)}  ${shortTool(entry.tool)}  ${repairLine(repair)}`)
  }
  lines.push('RECURRING SCHEMA ERRORS')
  const ranked = Object.entries(errors).sort((a, b) => b[1].count - a[1].count)
  if (ranked.length === 0) lines.push('  no schema errors this session')
  for (const [tool, entry] of ranked) lines.push(`  x${entry.count}  ${shortTool(tool)}  ${oneLine(entry.last, 100)}`)
  return lines.join('\n')
}

const openPane = async ($: Engine) => {
  try {
    await $.ui.open({ id: PANE, title: 'MENDER' })
  } catch {
    // No surface places panes (a -p run): the command's text reply stands.
  }
}

const forget = async ($: Engine, tool: string): Promise<string> => {
  const learned = await read($, learnedAtom)
  const names = tool === '' ? Object.keys(learned) : Object.keys(learned).filter(name => name === tool || shortTool(name) === tool)
  const kept = Object.fromEntries(Object.entries(learned).filter(([name]) => !names.includes(name)))
  await $.state.set(LEARNED, kept)
  try {
    await $.store.set(LEARNED_KEY, kept)
  } catch (error) {
    return `Forgot ${names.length} for this session, but the store could not be written: ${errorText(error)}`
  }
  return `Forgot ${names.length} learned shape${names.length === 1 ? '' : 's'}.`
}

const clearLog = async ($: Engine) => {
  await $.state.set(REPAIRS, [])
  await $.state.set(FIXED, 0)
  await $.state.set(ERRORS, {})
  await showStatus($)
}

export const register: Register = (on, options) => {
  const configuredFile = typeof options.schemaFile === 'string' ? options.schemaFile : ''
  const isLearning = options.learn !== false

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'mender',
        description: 'Show MCP argument repairs and recurring schema errors',
        argumentHint: '[list | reload | forget [tool] | off | on]',
      })
      await load($, configuredFile)
    } catch (error) {
      $.ui.toast(`MENDER: could not start (${errorText(error)})`)
    }
    return next(e)
  })

  on('command.run', { command: 'mender' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    switch (verb.toLowerCase()) {
      case '':
        await openPane($)
        return { text: await listText($) }
      case 'list':
        return { text: await listText($) }
      case 'reload':
        await load($, configuredFile)
        return { text: await listText($) }
      case 'forget':
        return { text: await forget($, rest.join(' ').trim()) }
      case 'off':
        await $.state.set(IS_OFF, true)
        return { text: 'MENDER OFF for this session: MCP calls go through untouched, with no notes, toasts or error log.' }
      case 'on':
        await $.state.set(IS_OFF, false)
        return { text: 'MENDER ON.' }
      default:
        return { text: USAGE }
    }
  })

  on('tool.call', async ($, e, next) => {
    if (!e.tool.startsWith('mcp__')) return next(e)
    let isOff = false
    try {
      isOff = await read($, offAtom)
    } catch {
      // Unknown means on.
    }
    // Off is a true pass-through: no repair, no notes, no toasts, no bookkeeping.
    if (isOff) return next(e)
    const tool = e.tool
    const envelope: Record<string, unknown> = {}
    const args: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(e as Record<string, unknown>)) (ENVELOPE.has(key) ? envelope : args)[key] = value

    let repairs: Repair[] = []
    let sent = args
    try {
      const schema = await schemaFor($, tool)
      if (schema !== undefined) ({ args: sent, repairs } = repairArguments(schema, args))
    } catch {
      repairs = []
      sent = args
    }

    const ran = await next(repairs.length > 0 ? ({ ...envelope, ...sent } as typeof e) : e)

    const notes: string[] = []
    try {
      if (repairs.length > 0) {
        notes.push(repairNote(tool, repairs))
        await recordRepair($, tool, repairs)
      }
      const failure = ran.deny ?? (ran.isError === true ? (ran.text ?? '') : undefined)
      const server = serverOf(tool)
      let isBack = false
      if (failure === undefined) {
        if (server !== undefined) isBack = await clearDown($, server)
      } else {
        const reason = downReason(failure, { isDeny: ran.deny !== undefined })
        if (reason !== undefined && server !== undefined) {
          if (await markDown($, server, reason)) $.ui.toast(`MENDER ▸ ${server.toUpperCase()} DOWN`)
          notes.push(downNote(server, reason))
        } else if (isSchemaError(failure)) {
          await recordError($, tool, failure)
          const learned = isLearning ? await learn($, tool, failure) : undefined
          if (learned !== undefined) {
            // The shape the next call is repaired against: the file's schema, if any, with the lesson on top.
            const shape = combine((await read($, schemasAtom))[tool] as JsonSchema | undefined, learned) ?? learned
            const again = repairArguments(shape, sent)
            notes.push(learnedNote(tool, factsFrom(failure), again.repairs.length > 0 ? again.args : undefined))
          }
        }
      }
      if (repairs.length > 0 || failure !== undefined || isBack) await showStatus($)
    } catch {
      // Bookkeeping never changes the call's outcome.
    }

    if (notes.length === 0) return ran
    if (ran.deny !== undefined) return { deny: [ran.deny, ...notes].join('\n') }
    return { ...ran, context: [...(ran.context ?? []), ...notes] } as typeof ran
  })

  // ── drawing ──────────────────────────────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const repairs = await read($, repairsAtom)
    const errors = await read($, errorsAtom)
    const down = await read($, downAtom)
    const fixed = await read($, fixedAtom)
    const isOff = await read($, offAtom)
    const problem = await read($, schemaProblemAtom)
    const fileCount = Object.keys(await read($, schemasAtom)).length
    const learnedCount = Object.keys(await read($, learnedAtom)).length
    const width = Math.max(24, e.props.bodyColumns)
    const isDown = Object.keys(down).length > 0
    const sprite = spriteRuns(isDown ? DOWN_SOCK_SPRITE : SOCK_SPRITE)
    const lines = repairs.flatMap(entry => entry.repairs.map(repair => ({ entry, repair }))).slice(-8)
    const ranked = Object.entries(errors).sort((a, b) => b[1].count - a[1].count).slice(0, 6)
    const toolWidth = Math.min(24, Math.max(8, ...lines.map(line => shortTool(line.entry.tool).length), ...ranked.map(([tool]) => shortTool(tool).length)))

    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row" gap={2}>
          <Box flexDirection="column">
            {sprite.map((row, y) => (
              <Box key={`sock-row-${y}`} flexDirection="row">
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
              <Text key="title" bold color={PICO8.w} backgroundColor={PICO8.b}>
                {' MENDER '}
              </Text>
              <Text bold color={isOff ? PICO8.d : PICO8.o}>
                {isOff ? 'OFF' : 'PATCH LOG'}
              </Text>
            </Box>
            <Text key="fixed" color={PICO8.o}>{`${fixed} CALL${fixed === 1 ? '' : 'S'} FIXED`}</Text>
            <Text color={PICO8.l}>{`${fileCount} FROM FILE · ${learnedCount} LEARNED`}</Text>
            {Object.entries(down).map(([server, reason]) => (
              <Text key={`down-${server}`} color={PICO8.r} wrap="truncate-end">
                {`◆ ${server.toUpperCase()} DOWN · ${reason.toUpperCase()}`}
              </Text>
            ))}
            {problem !== '' && (
              <Text key="problem" color={PICO8.y} wrap="truncate-end">
                {`! SCHEMA FILE: ${problem}`}
              </Text>
            )}
          </Box>
        </Box>
        <Text color={PICO8.d}>{'─'.repeat(Math.min(width, 60))}</Text>
        <Text bold color={PICO8.o}>
          REPAIRS
        </Text>
        {lines.length === 0 && (
          <Text key="no-repairs" color={PICO8.l}>
            NOTHING TO MEND YET.
          </Text>
        )}
        {lines.map(({ entry, repair }, index) => (
          <Box key={`repair-${index}`} flexDirection="row" gap={1}>
            <Text color={PICO8.d}>{clockText(entry.at)}</Text>
            <Text color={PICO8.w}>{shortTool(entry.tool).padEnd(toolWidth).slice(0, toolWidth)}</Text>
            <Text color={repair.kind === 'drop' ? PICO8.b : PICO8.o} wrap="truncate-end">
              {repairLine(repair)}
            </Text>
          </Box>
        ))}
        <Text bold color={PICO8.b}>
          RECURRING ERRORS
        </Text>
        {ranked.length === 0 && (
          <Text key="no-errors" color={PICO8.l}>
            NONE. CLEAN RUN.
          </Text>
        )}
        {ranked.map(([tool, entry]) => (
          <Box key={`error-${tool}`} flexDirection="row" gap={1}>
            <Text color={PICO8.r}>{`x${entry.count}`.padStart(3)}</Text>
            <Text color={PICO8.w}>{shortTool(tool).padEnd(toolWidth).slice(0, toolWidth)}</Text>
            <Text color={PICO8.l} wrap="truncate-end">
              {oneLine(entry.last, 80)}
            </Text>
          </Box>
        ))}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Button key="mender-clear" label="CLEAR LOG" onPress={() => clearLog($)} />
          <Button key="mender-forget" label="FORGET LEARNED" onPress={() => forget($, '')} />
          <Button
            key="mender-toggle"
            label={isOff ? 'TURN ON' : 'TURN OFF'}
            onPress={() => $.state.set(IS_OFF, !isOff)}
          />
        </Box>
      </Box>
    )
  })
}
