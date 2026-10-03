// tracer: merged is not deployed. Follows a merged commit through its
// workflow runs, deployments and an optional live URL, on a timer outside the
// model, and wakes the session once when the chain ends.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { TracerOutcome, TracerTrace } from '../types'
import type { DeploymentState, LiveResult } from './chain'
import {
  GLYPH,
  buildStages,
  chainText,
  currentStage,
  isLiveBody,
  latestPerEnvironment,
  liveUrlFor,
  needsLiveCheck,
  outcomeOf,
  parseEnvironments,
  shortSha,
  stageLabel,
  statusLine,
  toastText,
  wakeLine,
} from './chain'
import {
  REPO_VIEW_ARGV,
  commitArgv,
  deploymentStatusArgv,
  deploymentsArgv,
  describeGhFailure,
  describeSpawnFailure,
  parseJson,
  parseTraceRef,
  prViewArgv,
  readCommit,
  readDeployments,
  readLatestStatus,
  readPrView,
  readRuns,
  runsArgv,
} from './gh'
import type { TraceRef } from './gh'
import { PICO, SIGNATURE, levelMap } from './pixels'

const PANE = 'tracer'
const GH_TIMEOUT_MS = 30_000
const MAX_TRACES = 5
const USAGE = 'Use /trace 42, /trace owner/repo#42, /trace abc1234, a PR or commit URL, or /trace stop.'

const traces = atom({ plugin: 'tracer', key: 'traces' } as const, [] as TracerTrace[])

type Settings = {
  intervalMs: number
  timeoutMs: number
  environments: string[]
  liveUrl: string
  liveMatch: string
  wake: string
}
type Gh = { stdout: string } | { error: string }
type Polled = { trace: TracerTrace; toast: string | null; wake: string | null }

// Timers cannot live in $.state; a reload cancels this one, and session.start
// (raised on a reload too) arms it again.
let timer: Timer | null = null
let isPolling = false

/** Runs gh; every failure (missing, timed out, unauthenticated, any non-zero exit) becomes `{ error }`. */
async function gh($: EngineInterface, argv: readonly string[]): Promise<Gh> {
  const startedAt = await $.clock.now()
  try {
    const ran = await $.process.run(argv, { timeoutMs: GH_TIMEOUT_MS })
    return ran.exitCode === 0 ? { stdout: ran.stdout } : { error: describeGhFailure(ran.stderr) }
  } catch (error) {
    const elapsedMs = (await $.clock.now()) - startedAt
    return { error: describeSpawnFailure(error instanceof Error ? error.message : String(error), elapsedMs, GH_TIMEOUT_MS) }
  }
}

async function ghJson($: EngineInterface, argv: readonly string[]): Promise<{ json: unknown } | { error: string }> {
  const ran = await gh($, argv)
  return 'error' in ran ? ran : { json: parseJson(ran.stdout) }
}

type Target = { repo: string; sha: string; pr: number | null; title: string }

/** The repo and full merge commit SHA a /trace argument names, or why not. */
async function resolveTarget($: EngineInterface, ref: TraceRef): Promise<Target | { error: string }> {
  let repo = ref.repo
  if (repo === null) {
    const found = await gh($, REPO_VIEW_ARGV)
    if ('error' in found) return { error: `${found.error} (or name the repo: owner/repo#42)` }
    repo = found.stdout.trim()
    if (repo === '') return { error: 'gh found no GitHub repo here: name it, e.g. owner/repo#42.' }
  }
  if (ref.kind === 'pr') {
    const ran = await ghJson($, prViewArgv(repo, ref.number))
    if ('error' in ran) return ran
    const pr = readPrView(ran.json)
    if (pr === null) return { error: `PR #${ref.number} in ${repo}: unreadable gh output` }
    if (pr.state !== 'MERGED' || pr.mergeSha === null) {
      return { error: `PR #${ref.number} in ${repo} is not merged yet (${pr.state || 'unknown'}). Trace it once it merges.` }
    }
    return { repo, sha: pr.mergeSha, pr: ref.number, title: pr.title }
  }
  const ran = await ghJson($, commitArgv(repo, ref.sha))
  if ('error' in ran) return ran
  const commit = readCommit(ran.json)
  if (commit === null) return { error: `no commit ${ref.sha} in ${repo}` }
  return { repo, sha: commit.sha, pr: null, title: commit.title }
}

async function checkLive($: EngineInterface, settings: Settings, sha: string): Promise<LiveResult> {
  try {
    const response = await $.http.fetch(liveUrlFor(settings.liveUrl, sha))
    if (!response.ok) return { isLive: false, detail: `HTTP ${response.status}` }
    if (isLiveBody(response.text, sha, settings.liveMatch)) return { isLive: true, detail: settings.liveMatch ? 'MATCH SEEN' : 'SHA SEEN' }
    return { isLive: false, detail: `HTTP ${response.status}, ${settings.liveMatch ? 'MATCH' : 'SHA'} NOT SEEN YET` }
  } catch {
    return { isLive: false, detail: 'FETCH FAILED' }
  }
}

/** One read of the chain: runs, deployments (newest per environment) with their statuses, then the live URL. */
async function readChain($: EngineInterface, settings: Settings, trace: TracerTrace) {
  const runsRan = await ghJson($, runsArgv(trace.repo, trace.sha))
  if ('error' in runsRan) return runsRan
  const runs = readRuns(runsRan.json)
  if (runs === null) return { error: 'unreadable workflow runs' }
  const deploymentsRan = await ghJson($, deploymentsArgv(trace.repo, trace.sha))
  if ('error' in deploymentsRan) return deploymentsRan
  const listed = readDeployments(deploymentsRan.json)
  if (listed === null) return { error: 'unreadable deployments' }
  const deployments: DeploymentState[] = []
  for (const deployment of latestPerEnvironment(listed)) {
    const statusRan = await ghJson($, deploymentStatusArgv(trace.repo, deployment.id))
    if ('error' in statusRan) return statusRan
    const status = readLatestStatus(statusRan.json)
    if (status === null) return { error: `unreadable status of deployment ${deployment.id}` }
    deployments.push({ ...deployment, state: status.state })
  }
  const input = { runs, deployments, environments: settings.environments, hasLiveUrl: settings.liveUrl !== '', live: null }
  const stages = buildStages(input)
  if (!needsLiveCheck(stages)) return { stages }
  return { stages: buildStages({ ...input, live: await checkLive($, settings, trace.sha) }) }
}

/**
 * Polls one trace and says what moved (the toast and the wake line, for the
 * caller to use only if the trace is still on the map). The first poll (from
 * /trace) is a baseline: no toast and no wake, the reply says where it stands.
 */
async function pollTrace($: EngineInterface, settings: Settings, trace: TracerTrace, isFirst: boolean): Promise<Polled> {
  const now = await $.clock.now()
  if (!isFirst && now - trace.startedAt >= settings.timeoutMs) {
    const next: TracerTrace = { ...trace, outcome: 'timeout', checkedAt: now }
    return { trace: next, toast: toastText(trace, next), wake: null }
  }
  const read = await readChain($, settings, trace)
  if ('error' in read) {
    const toast = !isFirst && read.error !== trace.error ? `TRACER ${trace.pr === null ? shortSha(trace.sha) : `#${trace.pr}`}: ${read.error}` : null
    return { trace: { ...trace, error: read.error, checkedAt: now }, toast, wake: null }
  }
  const outcome: TracerOutcome = outcomeOf(read.stages, trace.startedAt, now, isFirst ? Number.POSITIVE_INFINITY : settings.timeoutMs)
  const isFinal = outcome === 'done' || outcome === 'failed'
  const next: TracerTrace = { ...trace, stages: read.stages, outcome, error: null, checkedAt: now, hasWoken: trace.hasWoken || isFinal }
  if (isFirst) return { trace: next, toast: null, wake: null }
  return { trace: next, toast: toastText(trace, next), wake: isFinal && !trace.hasWoken ? wakeLine(next, now - trace.startedAt) : null }
}

async function refreshStatus($: EngineInterface) {
  $.ui.status(statusLine(await read($, traces)))
}

/**
 * Puts a polled trace back, but only over the same trace: one stopped while
 * the poll was in flight stays gone, and one started again (a new startedAt)
 * is not overwritten by the stale copy. Says whether it replaced anything.
 */
async function replaceTrace($: EngineInterface, trace: TracerTrace): Promise<boolean> {
  let isReplaced = false
  await update($, traces, list =>
    list.map(one => {
      if (one.sha !== trace.sha || one.repo !== trace.repo || one.startedAt !== trace.startedAt) return one
      isReplaced = true
      return trace
    }),
  )
  return isReplaced
}

/** The timer's work: poll every trace still on the road, then wake once with every final line. */
async function tick($: EngineInterface, settings: Settings) {
  if (isPolling) return
  isPolling = true
  try {
    const live = (await read($, traces)).filter(trace => trace.outcome === 'tracing')
    if (live.length === 0) return
    const lines: string[] = []
    for (const trace of live) {
      const polled = await pollTrace($, settings, trace, false)
      if (!(await replaceTrace($, polled.trace))) continue
      if (polled.toast !== null) $.ui.toast(polled.toast)
      if (polled.wake !== null) lines.push(polled.wake)
    }
    await refreshStatus($)
    if (settings.wake === 'final' && lines.length > 0) {
      try {
        const sent = await $.prompt.submit({ text: lines.join('\n') })
        if (sent.drop !== undefined) $.ui.toast(`TRACER: wake refused: ${sent.drop}`)
      } catch {
        $.ui.toast('TRACER: could not submit the wake prompt')
      }
    }
  } finally {
    isPolling = false
  }
}

function who(trace: TracerTrace): string {
  return trace.pr === null ? shortSha(trace.sha) : `PR #${trace.pr} (${shortSha(trace.sha)})`
}

async function startTrace($: EngineInterface, settings: Settings, argument: string): Promise<string> {
  const ref = parseTraceRef(argument)
  if (ref === null) return `tracer: "${argument}" is not a PR or a commit. ${USAGE}`
  const target = await resolveTarget($, ref)
  if ('error' in target) return `tracer: not tracing: ${target.error}`
  const now = await $.clock.now()
  const fresh: TracerTrace = {
    ...target,
    startedAt: now,
    checkedAt: now,
    stages: buildStages({ runs: [], deployments: [], environments: settings.environments, hasLiveUrl: settings.liveUrl !== '', live: null }),
    outcome: 'tracing',
    hasWoken: false,
    error: null,
  }
  const { trace } = await pollTrace($, settings, fresh, true)
  await update($, traces, list =>
    [trace, ...list.filter(one => !(one.sha === trace.sha && one.repo === trace.repo))].slice(0, MAX_TRACES),
  )
  await refreshStatus($)
  const head = `${trace.repo} ${who(trace)}${trace.title ? ` "${trace.title.slice(0, 60)}"` : ''}`
  const chain = chainText(trace.stages)
  if (trace.error !== null) return `TRACER ON THE ROAD: ${head}, but GitHub could not be read yet: ${trace.error}. Retrying every ${Math.round(settings.intervalMs / 1000)}s.`
  if (trace.outcome === 'done') return `TRACER: ${head} is ALREADY THERE — ${chain}.`
  if (trace.outcome === 'failed') {
    const failed = trace.stages.find(stage => stage.state === 'failed')
    return `TRACER: ${head} ALREADY FAILED at ${failed ? stageLabel(failed) : 'a stage'} — ${failed?.detail ?? ''}. ${chain}.`
  }
  const promise = settings.wake === 'final' ? 'I will wake you when it gets there or a stage fails.' : 'Watch the status line (wake is off).'
  return `TRACER ON THE ROAD: ${head} — ${chain}. ${promise}`
}

async function stopTraces($: EngineInterface, argument: string): Promise<string> {
  const ref = argument === '' ? null : parseTraceRef(argument)
  if (argument !== '' && ref === null) return `tracer: "${argument}" is not a PR or a commit. ${USAGE}`
  const isGone = (trace: TracerTrace) =>
    ref === null ||
    (ref.kind === 'pr' ? trace.pr === ref.number : trace.sha.startsWith(ref.sha)) && (ref.repo === null || ref.repo === trace.repo)
  const list = await read($, traces)
  const gone = list.filter(isGone)
  if (gone.length === 0) return 'tracer: nothing to stop.'
  await update($, traces, all => all.filter(trace => !isGone(trace)))
  await refreshStatus($)
  return `tracer: stopped ${gone.map(trace => (trace.pr === null ? shortSha(trace.sha) : `#${trace.pr}`)).join(', ')}.`
}

async function removeTrace($: EngineInterface, trace: TracerTrace) {
  await update($, traces, list => list.filter(one => !(one.sha === trace.sha && one.repo === trace.repo)))
  await refreshStatus($)
}

const OUTCOME: Record<TracerOutcome, { label: (trace: TracerTrace) => string; color: string }> = {
  tracing: { label: () => '▶ ON THE ROAD...', color: PICO.yellow },
  done: { label: () => '★ COURSE CLEAR!', color: PICO.lime },
  failed: {
    label: trace => {
      const stage = trace.stages.find(one => one.state === 'failed')
      return `✕ GAME OVER: ${stage ? stageLabel(stage) : ''} FAILED`
    },
    color: PICO.red,
  },
  timeout: { label: () => '● TIME UP', color: PICO.orange },
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    intervalMs: Math.max(15, Number(options.intervalSeconds ?? 60) || 60) * 1000,
    timeoutMs: Math.max(1, Number(options.timeoutMinutes ?? 120) || 120) * 60_000,
    environments: parseEnvironments(options.environments),
    liveUrl: String(options.liveUrl ?? '').trim(),
    liveMatch: String(options.liveMatch ?? ''),
    wake: String(options.wake ?? 'final'),
  }

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'trace',
        description: 'tracer: follow a merged PR or commit until it is deployed; no argument opens the map',
        argumentHint: '[pr | sha | stop]',
      })
    } catch {
      $.ui.toast('TRACER: /trace could not be registered')
    }
    timer?.cancel()
    timer = $.clock.every(settings.intervalMs, () => {
      void tick($, settings).catch(() => undefined)
    })
    await refreshStatus($)
    return next(e)
  })

  on('command.run', { command: 'trace' }, async ($, e) => {
    const argument = (e.args ?? '').trim()
    const [word = '', ...rest] = argument.split(/\s+/)
    if (argument === '') {
      await $.ui.open({ id: PANE, title: 'TRACER' })
      const list = await read($, traces)
      return {
        text:
          list.length === 0
            ? `TRACER: nothing on the map. /trace 42 to insert coin. ${USAGE}`
            : list.map(trace => `TRACER ${who(trace)}: ${chainText(trace.stages)}`).join('\n'),
      }
    }
    if (word.toLowerCase() === 'stop' || word.toLowerCase() === 'off') return { text: await stopTraces($, rest.join(' ')) }
    return { text: await startTrace($, settings, argument) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, traces)
    const now = await $.clock.now()
    const width = Math.max(20, e.props.bodyColumns - 6)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text bold color={SIGNATURE}>
            T R A C E R
          </Text>
          <Text dimColor>
            {'  '}POLL {Math.round(settings.intervalMs / 1000)}S / WAKE {settings.wake.toUpperCase()} / GIVE UP {Math.round(settings.timeoutMs / 60_000)}M
          </Text>
        </Box>
        {list.length === 0 && (
          <Box key="empty" marginTop={1}>
            <Text color={PICO.lightGrey}>NO COURSE LOADED. /trace 42 TO INSERT COIN</Text>
          </Box>
        )}
        {list.map(trace => {
          const map = levelMap(trace.stages, trace.outcome === 'tracing', e.props.bodyColumns)
          const outcome = OUTCOME[trace.outcome]
          const elapsed = (trace.outcome === 'tracing' ? now : trace.checkedAt) - trace.startedAt
          const title = trace.title.length > width ? `${trace.title.slice(0, width - 1)}~` : trace.title
          const current = currentStage(trace.stages)
          return (
            <Box key={`trace-${trace.sha}`} flexDirection="column" marginTop={1}>
              <Box flexDirection="row">
                <Text bold color={SIGNATURE}>
                  {trace.pr === null ? shortSha(trace.sha) : `#${trace.pr}`}{' '}
                </Text>
                <Text wrap="truncate-end">{title}</Text>
              </Box>
              <Box flexDirection="row">
                <Box key={`outcome-${trace.sha}`}>
                  <Text bold color={outcome.color}>
                    {outcome.label(trace)}
                  </Text>
                </Box>
                <Text dimColor>
                  {'  '}WORLD {shortSha(trace.sha)} · {Math.floor(elapsed / 60_000)}M
                </Text>
              </Box>
              {map.pixels.length > 0 && (
                <Box key={`map-${trace.sha}`} flexDirection="column" marginTop={1}>
                  {map.pixels.map(runs => (
                    <Box flexDirection="row">
                      {runs.map(run => (
                        <Text color={run.color} backgroundColor={run.backgroundColor}>
                          {run.text}
                        </Text>
                      ))}
                    </Box>
                  ))}
                  {map.labels.map(cells => (
                    <Box flexDirection="row">
                      {cells.map(cell => (
                        <Text color={cell.color}>{cell.text}</Text>
                      ))}
                    </Box>
                  ))}
                </Box>
              )}
              {trace.stages.map(stage => (
                <Text color={stage.state === 'failed' ? PICO.red : stage === current && trace.outcome === 'tracing' ? PICO.blue : PICO.lightGrey}>
                  {GLYPH[stage.state]} {stageLabel(stage)}{stage.kind === 'merged' ? ` ${shortSha(trace.sha)}` : `: ${stage.detail}`}
                </Text>
              ))}
              {trace.error !== null && <Text color={PICO.red}>{trace.error}</Text>}
              <Box flexDirection="row">
                <Button
                  key={`stop-${trace.sha}`}
                  label={trace.outcome === 'tracing' ? 'STOP' : 'CLEAR'}
                  dimColor
                  onPress={() => removeTrace($, trace)}
                />
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
