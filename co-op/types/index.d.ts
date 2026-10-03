export type CoopSeverity = 'high' | 'medium' | 'low'

export type CoopVerdict = 'pass' | 'fail'

/** One thing the reviewer found. `file` is '' when the reviewer named none. */
export type CoopFinding = { severity: CoopSeverity; file: string; line?: number; summary: string }

/**
 * How a review ended:
 * - pass: the reviewer passed the diff (it may still list findings)
 * - flagged: the reviewer failed it, but with no high finding, so the PR went through
 * - blocked: a fail verdict with a high finding; `gh pr create` was denied
 * - unreadable: the reviewer errored or its reply did not parse; the PR went through
 * - skipped: `/coop skip` let this create through unreviewed
 * - empty: there was no diff against the base to review
 */
export type CoopOutcome = 'pass' | 'flagged' | 'blocked' | 'unreadable' | 'skipped' | 'empty'

export type CoopRun = {
  outcome: CoopOutcome
  findings: CoopFinding[]
  /** The ref the diff was taken against, e.g. origin/main. '' when unknown. */
  base: string
  /** `model:<name>` or `command:<argv0>`; '' when no reviewer ran. */
  reviewer: string
  /** True when the diff was cut to `maxDiffKb` before review. */
  isTruncated: boolean
  /** The whole diff's size in bytes, before any cut. */
  bytes: number
  maxDiffKb: number
  /** Why the review was unreadable, or why it was skipped. */
  reason?: string
  /** When the review ended, in ms since the epoch. */
  at: number
  /** The diff's hash, so the same diff is not reviewed twice in a row. */
  hash?: string
  /** What started it: a `gh pr create` call or the `/coop` command. */
  trigger: 'pr-create' | 'command'
}

declare module 'claude-code' {
  interface PluginState {
    'co-op': {
      last: CoopRun | null
      /** `/coop skip` armed: the next `gh pr create` goes through unreviewed. */
      skipNext: boolean
      /** True while a review is running. */
      isReviewing: boolean
      /** The band was dismissed with OK until the next review. */
      isBandHidden: boolean
    }
  }
}
