import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HonestExitCatch, HonestExitKind } from '../types'
import { KIND_LABEL, detect, outcomeOf, shortCommand, statusText } from './detect'
import type { Finding } from './detect'
import { rewriteCommand, rewriteNote } from './rewrite'
import { EXIT_SPRITE, PICO8, spriteRuns } from './sprite'

type Engine = EngineInterface

const PLUGIN = 'honest-exit'
const PANE = 'honest-exit'
const LOG_SIZE = 20

const CAUGHT = { plugin: 'honest-exit', key: 'caught' } as const
const caughtAtom = atom(CAUGHT, 0)
const LOG = { plugin: 'honest-exit', key: 'log' } as const
const logAtom = atom(LOG, [])

const KIND_COLOR: Record<HonestExitKind, string> = {
  'no-match': PICO8.o,
  'not-found': PICO8.y,
  'hidden-exit': PICO8.r,
}

const USAGE = [
  'usage: /honest-exit         show what was caught this session (opens the pane)',
  '       /honest-exit clear   reset the count',
].join('\n')

const two = (value: number) => String(value).padStart(2, '0')
const clockText = (ms: number) => {
  const at = new Date(ms)
  return `${two(at.getHours())}:${two(at.getMinutes())}`
}

const showStatus = async ($: Engine) => {
  $.ui.status(statusText(await read($, caughtAtom)))
}

/** Counts the findings, keeps the newest LOG_SIZE, toasts each and redraws the status. */
const record = async ($: Engine, command: string, findings: readonly Finding[], agentId: string | undefined) => {
  try {
    const at = await $.clock.now()
    const entries: HonestExitCatch[] = findings.map(finding => ({
      kind: finding.kind,
      command: shortCommand(command),
      clue: finding.clue,
      at,
      ...(agentId !== undefined ? { agentId } : {}),
    }))
    await update($, caughtAtom, count => count + findings.length)
    await update($, logAtom, log => [...log, ...entries].slice(-LOG_SIZE))
    await showStatus($)
  } catch {
    // Counting is decoration; the model note below is the point.
  }
  for (const finding of findings) $.ui.toast(finding.toast)
}

const clear = async ($: Engine) => {
  await $.state.set(CAUGHT, 0)
  await $.state.set(LOG, [])
  await showStatus($)
}

const summaryText = async ($: Engine, isRewriteOn: boolean): Promise<string> => {
  const caught = await read($, caughtAtom)
  const log = await read($, logAtom)
  const lines = [`HONEST EXIT ▸ ${caught} CAUGHT · rewrites ${isRewriteOn ? 'ON' : 'OFF'}`]
  if (log.length === 0) lines.push('  ALL CLEAR: no quiet shell failures this session')
  for (const entry of log) {
    const who = entry.agentId !== undefined ? ' SUBAGENT' : ''
    lines.push(`  ${clockText(entry.at)}  ${KIND_LABEL[entry.kind].padEnd(9)}${who}  ${entry.command}  (${entry.clue})`)
  }
  return lines.join('\n')
}

const openPane = async ($: Engine) => {
  try {
    await $.ui.open({ id: PANE, title: 'HONEST EXIT' })
  } catch {
    // No surface places panes (a -p run): the command's text reply stands.
  }
}

export const register: Register = (on, options) => {
  const isRewriteOn = options.rewrite === true

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: PLUGIN,
        description: 'Show the quiet shell failures caught this session',
        argumentHint: '[clear]',
      })
      await showStatus($)
    } catch {
      $.ui.toast('HONEST EXIT: /honest-exit could not be registered')
    }
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const notes: string[] = []
    let input = e
    if (isRewriteOn && typeof e.command === 'string') {
      const rewrite = rewriteCommand(e.command)
      if (rewrite.changes.length > 0) {
        input = { ...e, command: rewrite.command }
        notes.push(rewriteNote(e.command, rewrite))
      }
    }

    const ran = await next(input)
    if (ran.deny !== undefined) return notes.length > 0 ? { deny: [ran.deny, ...notes].join('\n') } : ran

    let findings: Finding[] = []
    try {
      const outcome = outcomeOf(ran)
      if (outcome !== undefined) findings = detect(input.command, outcome)
    } catch {
      findings = []
    }
    if (findings.length > 0) await record($, input.command, findings, e.agentId)

    const context = [...notes, ...findings.map(finding => finding.note)]
    if (context.length === 0) return ran
    return { ...ran, context: [...(ran.context ?? []), ...context] } as typeof ran
  })

  on('command.run', { command: PLUGIN }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'clear') {
      await clear($)
      return { text: await summaryText($, isRewriteOn) }
    }
    if (word !== '') return { text: USAGE }
    await openPane($)
    return { text: await summaryText($, isRewriteOn) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const caught = await read($, caughtAtom)
    const log = await read($, logAtom)
    const width = Math.max(24, e.props.bodyColumns)
    const sprite = spriteRuns(EXIT_SPRITE)

    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row" gap={2}>
          <Box flexDirection="column">
            {sprite.map((row, y) => (
              <Box key={`exit-row-${y}`} flexDirection="row">
                {row.map(run => (
                  <Text color={run.color} backgroundColor={run.backgroundColor}>
                    {run.text}
                  </Text>
                ))}
              </Box>
            ))}
          </Box>
          <Box flexDirection="column">
            <Text bold color={PICO8.e}>
              {'▶ HONEST EXIT'}
            </Text>
            <Text color={PICO8.w}>{`${caught} CAUGHT THIS SESSION`}</Text>
            <Text color={PICO8.l}>{`REWRITES ${isRewriteOn ? 'ON' : 'OFF'}`}</Text>
            <Box flexDirection="row" gap={1}>
              <Text color={PICO8.o}>■ GLOB</Text>
              <Text color={PICO8.y}>■ NOT FOUND</Text>
              <Text color={PICO8.r}>■ PIPE</Text>
            </Box>
          </Box>
        </Box>
        <Text color={PICO8.d}>{'─'.repeat(Math.min(width, 60))}</Text>
        {log.length === 0 && <Text color={PICO8.i}>ALL CLEAR · NO QUIET FAILURES YET</Text>}
        {log
          .slice()
          .reverse()
          .map((entry, index) => (
            <Box key={`catch-${index}`} flexDirection="row" gap={1}>
              <Text color={KIND_COLOR[entry.kind]}>{KIND_LABEL[entry.kind].padEnd(9)}</Text>
              <Text color={PICO8.l}>{clockText(entry.at)}</Text>
              {entry.agentId !== undefined && <Text color={PICO8.v}>SUB</Text>}
              <Box flexShrink={1}>
                <Text color={PICO8.w} wrap="truncate-end">
                  {`${entry.command}  ▸ ${entry.clue}`}
                </Text>
              </Box>
            </Box>
          ))}
        {log.length > 0 && (
          <Box flexDirection="row" marginTop={1}>
            <Button key="honest-exit-clear" label="CLEAR" onPress={() => clear($)} />
          </Box>
        )}
      </Box>
    )
  })
}
