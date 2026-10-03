/** CI on the head SHA: no runs yet is `pending`, never green. */
export type SentryCi = 'pending' | 'running' | 'failed' | 'green'

/** The PR's lifecycle as GitHub reports it. */
export type SentryLifecycle = 'OPEN' | 'CLOSED' | 'MERGED'

/** One truth snapshot of a PR, built from gh output. */
export type SentrySnapshot = {
  repo: string
  number: number
  title: string
  url: string
  state: SentryLifecycle
  headSha: string
  mergeStateStatus: string
  reviewDecision: string
  isInMergeQueue: boolean
  mergedAt: string | null
  ci: SentryCi
  checkCount: number
  runningChecks: number
  failedChecks: string[]
  openThreads: number
  /** The ids of the unresolved review threads, so a swap (one resolved, one opened) still reads as new. */
  openThreadIds: string[]
  /** Why the head's check-runs could not be read this poll, or null when they were. */
  ciError: string | null
}

/** One watched PR: the last snapshot, or the last error. */
export type SentryWatch = {
  repo: string
  number: number
  snapshot: SentrySnapshot | null
  error: string | null
  checkedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    sentry: { watches: SentryWatch[] }
  }
}
