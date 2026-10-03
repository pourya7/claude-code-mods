// dock: container stacks per worktree. Reads docker (never changes it), draws
// every compose stack with its memory and worktree, and asks before a stack
// boots when memory headroom is low.
import { atom, read } from 'claude-code'
import type { EngineInterface, Register, RenderSurface, Timer } from 'claude-code'

import type { DockHealth, DockSnapshot } from '../types'
import {
  COMPOSE_LS_ARGV,
  INFO_ARGV,
  PS_ARGV,
  STATS_ARGV,
  describeDockerFailure,
  downCommand,
  headroomBytes,
  isComposeUp,
  markOrphans,
  readInfo,
  readStacks,
} from './docker'
import { CRANE, PALETTE, barGrid, gaugeGrid, pixelRows } from './pixels'
import type { Run } from './pixels'
import { gib, guardReason, hereDir, isLowFuel, offlineLine, shortenPath, summaryText } from './text'

const PANE = 'dock'
const DOCKER_TIMEOUT_MS = 20_000
const GIB = 1024 ** 3

const snapshotAtom = atom({ plugin: 'dock', key: 'snapshot' } as const, null as DockSnapshot | null)
const cwdAtom = atom({ plugin: 'dock', key: 'cwd' } as const, '')

type Ran = { stdout: string } | { health: DockHealth; message: string }

// Timers cannot live in $.state, and a reload cancels them along with this
// variable; session.start (raised on a reload too) arms it again while the pane is up.
let timer: Timer | undefined

function stopTimer(): void {
  timer?.cancel()
  timer = undefined
}

/** Runs one read-only docker probe; every failure becomes a health and a line. */
async function docker($: EngineInterface, argv: readonly string[]): Promise<Ran> {
  try {
    const ran = await $.process.run(argv, { timeoutMs: DOCKER_TIMEOUT_MS })
    if (ran.exitCode === 0) return { stdout: ran.stdout }
    const serverError = readInfo(ran.stdout).serverError ?? ''
    return describeDockerFailure(`${ran.stderr}\n${serverError}`.trim())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/timed? ?out|timeout|still running/i.test(message)) {
      return { health: 'error', message: `docker did not answer within ${DOCKER_TIMEOUT_MS / 1000}s` }
    }
    return { health: 'no-docker', message: `docker could not run (${message.slice(0, 120)})` }
  }
}

/** Reads docker once, marks orphans on disk, records and returns the snapshot. */
async function scan($: EngineInterface): Promise<DockSnapshot> {
  const checkedAt = await $.clock.now()
  const offline = (health: DockHealth, message: string): DockSnapshot => ({
    health,
    message,
    checkedAt,
    totalBytes: 0,
    usedBytes: 0,
    stacks: [],
  })

  const snapshot = await (async (): Promise<DockSnapshot> => {
    const info = await docker($, INFO_ARGV)
    if (!('stdout' in info)) return offline(info.health, info.message)
    const engine = readInfo(info.stdout)
    if (engine.serverError !== null) return offline('daemon-down', engine.serverError)
    const outputs: string[] = []
    for (const argv of [COMPOSE_LS_ARGV, PS_ARGV, STATS_ARGV]) {
      const ran = await docker($, argv)
      if (!('stdout' in ran)) return offline(ran.health, ran.message)
      outputs.push(ran.stdout)
    }
    const [ls = '', ps = '', stats = ''] = outputs
    const found = readStacks(ls, ps, stats)
    const missing = new Set<string>()
    for (const dir of new Set(found.stacks.flatMap(stack => (stack.workingDir === null ? [] : [stack.workingDir])))) {
      try {
        if (!(await $.fs.exists(dir))) missing.add(dir)
      } catch {
        // A path dock cannot check is not called an orphan.
      }
    }
    return {
      health: 'ok',
      message: '',
      checkedAt,
      totalBytes: engine.totalBytes ?? found.limitBytes ?? 0,
      usedBytes: found.usedBytes,
      stacks: markOrphans(found.stacks, missing),
    }
  })()

  await $.state.set({ plugin: 'dock', key: 'snapshot' }, snapshot)
  return snapshot
}

// The docker scan in flight, if any. A reload starts this module afresh.
let inFlight: Promise<DockSnapshot> | undefined

/**
 * One docker scan at a time: the timer, RESCAN, /dock and the guard share the
 * scan still running instead of starting probes of their own, so a slow docker
 * never stacks probes and an older scan never lands over a newer one.
 */
function scanShared($: EngineInterface): Promise<DockSnapshot> {
  inFlight ??= scan($).finally(() => {
    inFlight = undefined
  })
  return inFlight
}

async function isPaneUp($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(pane => pane.id === PANE)
  } catch {
    return false
  }
}

/** Reads docker every interval while the pane is up; stops itself once it is gone. */
function arm($: EngineInterface, intervalMs: number): void {
  if (timer !== undefined) return
  timer = $.clock.every(intervalMs, () => {
    void (async () => {
      if (!(await isPaneUp($))) return stopTimer()
      await scanShared($)
    })().catch(stopTimer)
  })
}

/**
 * CLOSE: stops the timer, then closes. The pane's own `$.ui.close` skips this
 * plugin's `ui.close` hook, which hears only the person's and the engine's closes.
 */
async function closePane($: EngineInterface): Promise<void> {
  stopTimer()
  await $.ui.close({ id: PANE })
}

/** DOWN: hands the person the exact command. dock never runs it. */
async function offerDown($: EngineInterface, project: string, surface: RenderSurface): Promise<void> {
  const command = downCommand(project)
  let isCopied = false
  try {
    isCopied = (await $.ui.copy({ text: command, surface })).isCopied
  } catch {
    isCopied = false
  }
  if (isCopied) return $.ui.toast(`DOCK ▸ COPIED: ${command}`)
  // Only an empty prompt box takes the command: a draft the person is typing is
  // never touched. `append` keeps a draft even if the read came back blank.
  let isFilled = false
  try {
    const draft = (await $.prompt.read()).text
    if (draft.trim() === '') isFilled = (await $.prompt.fill({ text: command, mode: 'append' })).isFilled
  } catch {
    isFilled = false
  }
  $.ui.toast(isFilled ? `DOCK ▸ IN YOUR PROMPT BOX: ${command}` : `DOCK ▸ RUN IT YOURSELF: ${command}`)
}

export const register: Register = (on, options) => {
  const intervalMs = Math.max(5, Number(options.intervalSeconds ?? 30) || 30) * 1000
  const isGuardOn = options.guard !== false
  const minGiB = Math.max(0, Number(options.minHeadroomGiB ?? 3) || 0)

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'dock', description: 'dock: container stacks per worktree, memory headroom and orphans' })
    } catch {
      $.ui.toast('DOCK: /dock could not be registered')
    }
    await $.state.set({ plugin: 'dock', key: 'cwd' }, e.cwd)
    stopTimer()
    if (await isPaneUp($)) arm($, intervalMs)
    return next(e)
  })

  on('command.run', { command: 'dock' }, async $ => {
    try {
      await $.ui.open({ id: PANE, title: 'DOCK' })
    } catch {
      // No pane on this surface: the reply below carries the same facts.
    }
    const snapshot = await scanShared($)
    arm($, intervalMs)
    return { text: summaryText(snapshot, minGiB) }
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE) stopTimer()
    return result
  })

  on('tool.check', async ($, e, next) => {
    const decided = await next(e)
    if (!isGuardOn || decided.decision === 'deny' || e.tool !== 'Bash') return decided
    const command = typeof e.input === 'object' && e.input !== null ? (e.input as { command?: unknown }).command : undefined
    if (typeof command !== 'string' || !isComposeUp(command)) return decided
    // A query ($.tool.check, no tool_use_id) runs nothing: it gets the same
    // verdict from the last scan when there is one, and never a toast.
    const isQuery = e.tool_use_id === undefined
    try {
      const last = isQuery ? await read($, snapshotAtom) : null
      const snapshot = last ?? (await scanShared($))
      if (!isLowFuel(snapshot, minGiB)) return decided
      if (!isQuery) $.ui.toast(`DOCK ▸ LOW FUEL: ${gib(headroomBytes(snapshot))} GIB FREE`)
      return { decision: 'ask', reason: guardReason(snapshot, minGiB) }
    } catch {
      return decided
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const snapshot = await read($, snapshotAtom)
    const cwd = await read($, cwdAtom)
    const columns = Math.max(30, e.props.bodyColumns)

    const pixels = (grid: readonly string[]) =>
      pixelRows(grid).map(runs => (
        <Box flexDirection="row">
          {runs.map((run: Run) => (
            <Text color={run.color} backgroundColor={run.backgroundColor}>
              {run.text}
            </Text>
          ))}
        </Box>
      ))

    const closeButton = <Button key="close" label="CLOSE" hotkey="x" role="dismiss" onPress={() => closePane($)} />

    const isOk = snapshot !== null && snapshot.health === 'ok'
    const isLow = snapshot !== null && isLowFuel(snapshot, minGiB)
    const gaugeWidth = Math.max(8, Math.min(24, columns - 40))
    const total = snapshot?.totalBytes ?? 0
    const redLine = total > 0 ? Math.max(0, total - minGiB * GIB) / total : 1

    const header = (
      <Box flexDirection="row">
        <Box key="crane" flexDirection="column" marginRight={2}>
          {pixels(CRANE)}
        </Box>
        <Box flexDirection="column">
          <Text bold color={PALETTE.u}>
            D O C K
          </Text>
          {isOk && snapshot ? (
            <Box key="gauge" flexDirection="row">
              <Text color={PALETTE.l}>MEM </Text>
              <Box flexDirection="column">{pixels(gaugeGrid(total > 0 ? snapshot.usedBytes / total : 0, redLine, gaugeWidth))}</Box>
              <Text color={PALETTE.l}>
                {' '}
                {gib(snapshot.usedBytes)}/{gib(total)} GIB
              </Text>
            </Box>
          ) : null}
          {isOk && snapshot ? (
            <Box key="headroom">
              <Text bold color={isLow ? PALETTE.r : PALETTE.u}>
                {`HEADROOM ${gib(headroomBytes(snapshot))} GIB ${isLow ? `▶ LOW FUEL (MIN ${minGiB})` : '▶ FUEL OK'}`}
              </Text>
            </Box>
          ) : null}
        </Box>
      </Box>
    )

    if (!isOk || snapshot === null) {
      return (
        <Box flexDirection="column">
          {header}
          <Box key="offline" marginTop={1}>
            <Text color={snapshot === null ? PALETTE.l : PALETTE.r}>
              {snapshot === null ? 'SCANNING DOCKER... (OR /dock TO INSERT COIN)' : offlineLine(snapshot)}
            </Text>
          </Box>
          <Box flexDirection="row" marginTop={1}>
            <Button key="rescan" label="RESCAN" hotkey="r" onPress={() => scanShared($)} />
            <Text> </Text>
            {closeButton}
          </Box>
        </Box>
      )
    }

    const nameWidth = Math.min(18, Math.max(5, ...snapshot.stacks.map(stack => stack.name.length)))
    const stateWidth = Math.max(4, ...snapshot.stacks.map(stack => stack.stateLabel.length))
    const pathWidth = Math.max(10, columns - 4)
    const mine = hereDir(
      snapshot.stacks.map(stack => stack.workingDir),
      cwd,
    )

    return (
      <Box flexDirection="column">
        {header}
        {snapshot.stacks.length === 0 ? (
          <Box key="empty" marginTop={1}>
            <Text color={PALETTE.l}>NO STACKS IN PORT. docker compose up TO DOCK ONE</Text>
          </Box>
        ) : null}
        {snapshot.stacks.map(stack => {
          const isMine = stack.workingDir !== null && stack.workingDir === mine
          const name = stack.name.length > nameWidth ? `${stack.name.slice(0, nameWidth - 1)}~` : stack.name.padEnd(nameWidth)
          const where = stack.isOrphan
            ? `ORPHAN ${shortenPath(stack.workingDir ?? '', pathWidth - 7)}`
            : shortenPath(stack.workingDir ?? 'WORKTREE UNKNOWN', pathWidth)
          return (
            <Box key={`stack-${stack.name}`} flexDirection="column" marginTop={1}>
              <Box flexDirection="row">
                <Text color={isMine ? PALETTE.y : PALETTE.n}>{isMine ? '◆ ' : '  '}</Text>
                <Text bold color={stack.isOrphan ? PALETTE.r : PALETTE.w}>
                  {name}
                </Text>
                <Text color={stack.isRunning ? PALETTE.e : PALETTE.d}> {stack.stateLabel.padEnd(stateWidth)} </Text>
                <Box flexDirection="column">
                  {pixels(barGrid(total > 0 ? stack.memoryBytes / total : 0, 8, stack.isOrphan ? 'r' : 'u'))}
                </Box>
                <Text color={PALETTE.l}> {gib(stack.memoryBytes).padStart(4)}G </Text>
                <Button key={`down-${stack.name}`} label="DOWN" onPress={press => offerDown($, stack.name, press.surface)} />
              </Box>
              <Box key={`where-${stack.name}`}>
                <Text color={stack.isOrphan ? PALETTE.r : PALETTE.l}>{`    ${where}`}</Text>
              </Box>
            </Box>
          )
        })}
        <Box flexDirection="row" marginTop={1}>
          <Button key="rescan" label="RESCAN" hotkey="r" onPress={() => scanShared($)} />
          <Text> </Text>
          {closeButton}
          <Text color={PALETTE.d}> EVERY {String(intervalMs / 1000)}S WHILE OPEN · DOWN COPIES, NEVER RUNS</Text>
        </Box>
      </Box>
    )
  })
}
