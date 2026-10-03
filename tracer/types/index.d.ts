/** Where one stage of the chain stands: ● pending, ★ done, ✕ failed. */
export type TracerStageState = 'pending' | 'done' | 'failed'

/** One node on the level map: MERGED, BUILD, DEPLOY:<env> or LIVE. */
export type TracerStage = {
  /** `merged`, `build`, `deploy:<env>` or `live`. */
  id: string
  kind: 'merged' | 'build' | 'deploy' | 'live'
  /** The environment name, for a deploy stage. */
  environment?: string
  state: TracerStageState
  /** One short line on why the stage stands where it does. */
  detail: string
}

/** How a trace ended, or `tracing` while it still polls. */
export type TracerOutcome = 'tracing' | 'done' | 'failed' | 'timeout'

/** One merged commit being followed until it is deployed (and optionally live). */
export type TracerTrace = {
  repo: string
  /** The full merge commit SHA. */
  sha: string
  pr: number | null
  title: string
  startedAt: number
  checkedAt: number
  stages: TracerStage[]
  outcome: TracerOutcome
  /** Set once the session was woken for this trace, so it is never woken twice. */
  hasWoken: boolean
  /** Why the last poll could not read GitHub (or the live URL), or null. */
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    tracer: { traces: TracerTrace[] }
  }
}
