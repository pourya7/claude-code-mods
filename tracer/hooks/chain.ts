// The chain MERGED ▸ BUILD ▸ DEPLOY:<env> ▸ LIVE: stages from GitHub data,
// the outcome, and every line of text tracer says. Pure: no `$` here.
import type { TracerOutcome, TracerStage, TracerTrace } from '../types'

/** One workflow run on the merge commit, as `actions/runs?head_sha=` lists it. */
export type WorkflowRun = { name: string; status: string; conclusion: string | null }

/** One deployment of the merge commit, with the state of its newest status (null: none yet). */
export type DeploymentState = { id: number; environment: string; createdAt: string; state: string | null }

/** What the live URL said, or null when it was not fetched. */
export type LiveResult = { isLive: boolean; detail: string }

export type ChainInput = {
  /** Workflow runs on the SHA. */
  runs: WorkflowRun[]
  deployments: DeploymentState[]
  /** `userConfig.environments`: deploy stages to wait for, in order. */
  environments: string[]
  hasLiveUrl: boolean
  live: LiveResult | null
}

const PASSED = new Set(['success', 'neutral', 'skipped'])
const WAITING = new Set(['action_required'])
const DEPLOY_DONE = new Set(['success', 'inactive'])
const DEPLOY_FAILED = new Set(['failure', 'error'])

export const GLYPH: Record<TracerStage['state'], string> = { pending: '●', done: '★', failed: '✕' }

/** Workflow and environment names come from whoever wrote them: plain characters, 40 columns. */
export function cleanName(name: string): string {
  return name.replace(/[^A-Za-z0-9 .:/()_-]/g, '').trim().slice(0, 40)
}

function quotedList(names: readonly string[]): string {
  const unique = [...new Set(names.map(cleanName))]
  const shown = unique.slice(0, 3).map(name => `"${name}"`)
  return unique.length > 3 ? `${shown.join(', ')} +${unique.length - 3} more` : shown.join(', ')
}

function buildStage(runs: readonly WorkflowRun[]): TracerStage {
  const stage = (state: TracerStage['state'], detail: string): TracerStage => ({ id: 'build', kind: 'build', state, detail })
  if (runs.length === 0) return stage('pending', 'NO RUNS YET')
  const completed = runs.filter(run => run.status === 'completed')
  const failed = completed.filter(run => !PASSED.has(run.conclusion ?? '') && !WAITING.has(run.conclusion ?? ''))
  if (failed.length > 0) return stage('failed', `FAILED: ${quotedList(failed.map(run => run.name))}`)
  const passed = completed.filter(run => PASSED.has(run.conclusion ?? '')).length
  const waiting = completed.length - passed
  const running = runs.length - completed.length
  if (running === 0 && waiting === 0) return stage('done', `${passed}/${runs.length} RUNS PASSED`)
  const parts = [running > 0 ? `${running} RUNNING` : '', waiting > 0 ? `${waiting} WAITING FOR APPROVAL` : '', passed > 0 ? `${passed} PASSED` : '']
  return stage('pending', parts.filter(part => part !== '').join(', '))
}

function newest<T extends { id: number; createdAt: string }>(a: T, b: T): T {
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? a : b
  return a.id > b.id ? a : b
}

type Dated = { id: number; environment: string; createdAt: string }

/** The newest deployment of each environment (names compared without case), so only those need a status read. */
export function latestPerEnvironment<T extends Dated>(deployments: readonly T[]): T[] {
  const latest = new Map<string, T>()
  for (const deployment of deployments) {
    const key = deployment.environment.toLowerCase()
    const known = latest.get(key)
    latest.set(key, known === undefined ? deployment : newest(known, deployment))
  }
  return [...latest.values()]
}

function deployStage(environment: string, deployment: DeploymentState | undefined): TracerStage {
  const base = { id: `deploy:${environment}`, kind: 'deploy' as const, environment }
  if (deployment === undefined) return { ...base, state: 'pending', detail: 'NO DEPLOYMENT YET' }
  const state = deployment.state
  if (state === null) return { ...base, state: 'pending', detail: 'NO STATUS YET' }
  const detail = state.replace(/_/g, ' ').toUpperCase()
  if (DEPLOY_DONE.has(state)) return { ...base, state: 'done', detail }
  if (DEPLOY_FAILED.has(state)) return { ...base, state: 'failed', detail }
  return { ...base, state: 'pending', detail }
}

/**
 * MERGED (always done: only merged commits are traced), BUILD, one DEPLOY per
 * environment (the configured ones first, then any others in the order they
 * appeared; the newest deployment of each wins) and LIVE when a URL is set.
 */
export function buildStages(input: ChainInput): TracerStage[] {
  const latest = new Map<string, DeploymentState>()
  const firstSeen: string[] = []
  const ordered = [...input.deployments].sort((a, b) => (a.createdAt === b.createdAt ? a.id - b.id : a.createdAt < b.createdAt ? -1 : 1))
  for (const deployment of ordered) {
    const key = deployment.environment.toLowerCase()
    const known = latest.get(key)
    if (known === undefined) firstSeen.push(deployment.environment)
    latest.set(key, known === undefined ? deployment : newest(known, deployment))
  }
  const configured = new Set(input.environments.map(name => name.toLowerCase()))
  const environments = [...input.environments, ...firstSeen.filter(name => !configured.has(name.toLowerCase()))]

  const stages: TracerStage[] = [
    { id: 'merged', kind: 'merged', state: 'done', detail: 'MERGED' },
    buildStage(input.runs),
    ...environments.map(name => deployStage(name, latest.get(name.toLowerCase()))),
  ]
  if (input.hasLiveUrl) {
    const live = input.live
    stages.push({
      id: 'live',
      kind: 'live',
      state: live?.isLive ? 'done' : 'pending',
      detail: live === null ? 'WAITS FOR DEPLOY' : live.detail,
    })
  }
  return stages
}

/** True when every stage before LIVE is done, so the live URL is worth a fetch. */
export function needsLiveCheck(stages: readonly TracerStage[]): boolean {
  const live = stages.at(-1)
  if (live?.kind !== 'live' || live.state === 'done') return false
  return stages.slice(0, -1).every(stage => stage.state === 'done')
}

/** The first stage not done yet: where the player stands on the map. */
export function currentStage(stages: readonly TracerStage[]): TracerStage | undefined {
  return stages.find(stage => stage.state !== 'done')
}

export function outcomeOf(stages: readonly TracerStage[], startedAt: number, now: number, timeoutMs: number): TracerOutcome {
  if (stages.some(stage => stage.state === 'failed')) return 'failed'
  if (stages.every(stage => stage.state === 'done')) return 'done'
  return now - startedAt >= timeoutMs ? 'timeout' : 'tracing'
}

export function stageLabel(stage: TracerStage): string {
  if (stage.kind === 'deploy') return `DEPLOY:${cleanName(stage.environment ?? '').toUpperCase()}`
  return stage.kind.toUpperCase()
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

/** The live URL with `{sha}` and `{short}` filled in. */
export function liveUrlFor(template: string, sha: string): string {
  return fillSha(template, sha, encodeURIComponent)
}

function fillSha(template: string, sha: string, encode: (text: string) => string = text => text): string {
  return template.replace(/\{sha\}/g, encode(sha)).replace(/\{short\}/g, encode(shortSha(sha)))
}

/** Live when the body holds `liveMatch` (placeholders filled), or else the full or short SHA. */
export function isLiveBody(body: string, sha: string, liveMatch: string): boolean {
  if (liveMatch.trim() !== '') return body.includes(fillSha(liveMatch, sha))
  return body.includes(sha) || body.includes(shortSha(sha))
}

export function parseEnvironments(text: unknown): string[] {
  if (typeof text !== 'string') return []
  return text
    .split(',')
    .map(name => name.trim())
    .filter(name => name !== '')
}

function who(trace: TracerTrace): string {
  return trace.pr === null ? shortSha(trace.sha) : `#${trace.pr}`
}

function whoLong(trace: TracerTrace): string {
  return trace.pr === null ? shortSha(trace.sha) : `PR #${trace.pr} (${shortSha(trace.sha)})`
}

export function glyphs(stages: readonly TracerStage[]): string {
  return stages.map(stage => GLYPH[stage.state]).join('')
}

/** `★ MERGED ▸ ★ BUILD ▸ ● LIVE` for replies and the pane. */
export function chainText(stages: readonly TracerStage[]): string {
  return stages.map(stage => `${GLYPH[stage.state]} ${stageLabel(stage)}`).join(' ▸ ')
}

function where(trace: TracerTrace): string {
  if (trace.outcome === 'done') return 'CLEAR!'
  if (trace.outcome === 'failed') {
    // The stage that failed, not the first one still pending ahead of it.
    const failed = trace.stages.find(one => one.state === 'failed')
    return `${failed ? stageLabel(failed) : ''} FAILED`
  }
  if (trace.outcome === 'timeout') return 'TIME UP'
  const stage = currentStage(trace.stages)
  return stage ? stageLabel(stage) : ''
}

const STATUS_COLUMNS = 40

/** `TRACER #42 ★★●● DEPLOY:PRODUCTION` for the newest trace, then `+n` more; under 40 columns. */
export function statusLine(traces: readonly TracerTrace[]): string | undefined {
  const [first, ...rest] = traces
  if (first === undefined) return undefined
  const tail = `${first.error !== null && first.outcome === 'tracing' ? ' ERR' : ''}${rest.length > 0 ? ` +${rest.length}` : ''}`
  const line = `TRACER ${who(first)} ${glyphs(first.stages)} ${where(first)}`
  const room = STATUS_COLUMNS - tail.length
  return `${line.length > room ? `${line.slice(0, room - 1)}~` : line}${tail}`
}

function minutes(elapsedMs: number): string {
  return `${Math.max(0, Math.floor(elapsedMs / 60_000))}m`
}

/** The one line the session is woken with, when the chain is done or failed. */
export function wakeLine(trace: TracerTrace, elapsedMs: number): string {
  const path = trace.stages.map(stageLabel).join(' ▸ ')
  if (trace.outcome === 'failed') {
    const stage = trace.stages.find(one => one.state === 'failed')
    return `TRACER: ${whoLong(trace)} FAILED at ${stage ? stageLabel(stage) : 'a stage'} — ${stage?.detail ?? 'unknown'}. Investigate.`
  }
  const last = trace.stages.at(-1)
  if (last?.kind === 'live') return `TRACER: ${whoLong(trace)} is LIVE — ${path} in ${minutes(elapsedMs)}.`
  const note = last?.kind === 'build' ? ' No deployments to follow.' : ''
  return `TRACER: ${whoLong(trace)} reached ${last ? stageLabel(last) : 'the end'} — ${path} in ${minutes(elapsedMs)}.${note}`
}

/** What moved between two polls, or null when nothing did. */
export function toastText(before: TracerTrace, after: TracerTrace): string | null {
  if (after.outcome === 'timeout' && before.outcome !== 'timeout') {
    const stage = currentStage(after.stages)
    return `TRACER ${who(after)} TIME UP AT ${stage ? stageLabel(stage) : 'THE END'}`
  }
  const previous = new Map(before.stages.map(stage => [stage.id, stage.state]))
  const moved = after.stages.filter(stage => stage.state !== 'pending' && previous.get(stage.id) !== stage.state)
  if (moved.length === 0) return null
  const parts = moved.map(stage => (stage.state === 'failed' ? `✕ ${stageLabel(stage)} FAILED` : `★ ${stageLabel(stage)}`))
  return `TRACER ${who(after)} ${parts.join(' ')}`
}
