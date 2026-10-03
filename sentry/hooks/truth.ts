// The truth rules: what gh output means, which changes matter, and how to say so.
import type { SentryCi, SentryLifecycle, SentrySnapshot } from '../types'

/** One check-run as the GitHub REST API reports it. */
export type CheckRun = { name: string; status: string; conclusion: string | null }

/** The PR fields read from GraphQL. */
export type PullRequestPayload = {
  number: number
  title: string
  url: string
  state: string
  headRefOid: string
  mergeStateStatus: string | null
  reviewDecision: string | null
  isInMergeQueue: boolean | null
  mergedAt: string | null
}

export type CiVerdict = { ci: SentryCi; failedChecks: string[]; runningChecks: number; checkCount: number }

export type TransitionKind =
  | 'ci-failed'
  | 'ready'
  | 'changes-requested'
  | 'new-thread'
  | 'merged'
  | 'closed'
  | 'ci-green'
  | 'ci-running'
  | 'head-moved'
  | 'approved'
  | 'review-changed'
  | 'threads-resolved'
  | 'queued'
  | 'dequeued'

export type Transition = { kind: TransitionKind; delta?: number }

/** Worst first: the beacon shows the first level any PR is at. */
export type Level = 'failed' | 'error' | 'attention' | 'waiting' | 'ready' | 'done' | 'idle'

const LEVEL_ORDER: readonly Level[] = ['failed', 'error', 'attention', 'waiting', 'ready', 'done', 'idle']
const PASSED = new Set(['success', 'neutral', 'skipped'])
const ACTIONABLE = new Set<TransitionKind>(['ci-failed', 'ready', 'changes-requested', 'new-thread', 'merged', 'closed'])

export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

const CHECK_NAME_MAX = 40
const CHECK_NAMES_SHOWN = 3

/**
 * A check-run name made safe to show and to put in a wake prompt: anyone who
 * can push a workflow names it, so keep a plain character set and a short cap. Idempotent.
 */
export function checkName(name: string): string {
  const safe = name
    .replace(/[^\w .:/()~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (safe === '') return 'unnamed'
  return safe.length > CHECK_NAME_MAX ? `${safe.slice(0, CHECK_NAME_MAX - 1)}~` : safe
}

/** At most three quoted, sanitised check names, then `+n more`: data, never instructions. */
export function checkList(names: readonly string[]): string {
  const shown = names.slice(0, CHECK_NAMES_SHOWN).map(name => `"${checkName(name)}"`)
  const more = names.length > CHECK_NAMES_SHOWN ? ` +${names.length - CHECK_NAMES_SHOWN} more` : ''
  return `${shown.join(', ')}${more}`
}

/**
 * CI for one head SHA. No runs is pending (never green); any completed run
 * that did not pass is failed; any run not completed is running; else green.
 */
export function ciFromRuns(runs: readonly CheckRun[]): CiVerdict {
  const failedChecks: string[] = []
  let runningChecks = 0
  for (const run of runs) {
    if (run.status !== 'completed') runningChecks += 1
    else if (!PASSED.has(run.conclusion ?? '')) failedChecks.push(checkName(run.name))
  }
  const ci: SentryCi =
    runs.length === 0 ? 'pending' : failedChecks.length > 0 ? 'failed' : runningChecks > 0 ? 'running' : 'green'
  return { ci, failedChecks, runningChecks, checkCount: runs.length }
}

function lifecycle(state: string): SentryLifecycle {
  return state === 'MERGED' || state === 'CLOSED' ? state : 'OPEN'
}

/**
 * A snapshot from one poll. `runs` null means the check-runs could not be
 * read (`ciError` says why): the last CI stands only while the head is the
 * same one.
 */
export function buildSnapshot(
  repo: string,
  pr: PullRequestPayload,
  openThreadIds: readonly string[],
  runs: readonly CheckRun[] | null,
  previous: SentrySnapshot | null,
  ciError: string | null = null,
): SentrySnapshot {
  const sameHead = previous !== null && previous.headSha === pr.headRefOid
  const verdict: CiVerdict =
    runs !== null
      ? ciFromRuns(runs)
      : sameHead && previous !== null
        ? {
            ci: previous.ci,
            failedChecks: previous.failedChecks,
            runningChecks: previous.runningChecks,
            checkCount: previous.checkCount,
          }
        : { ci: 'pending', failedChecks: [], runningChecks: 0, checkCount: 0 }
  return {
    repo,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: lifecycle(pr.state),
    headSha: pr.headRefOid,
    mergeStateStatus: pr.mergeStateStatus ?? '',
    reviewDecision: pr.reviewDecision ?? '',
    isInMergeQueue: pr.isInMergeQueue === true,
    mergedAt: pr.mergedAt,
    openThreads: openThreadIds.length,
    openThreadIds: [...openThreadIds],
    ...verdict,
    ciError: runs === null ? (ciError ?? 'check-runs unreadable') : null,
  }
}

export function isReady(snapshot: SentrySnapshot): boolean {
  return (
    snapshot.state === 'OPEN' &&
    snapshot.ci === 'green' &&
    snapshot.reviewDecision === 'APPROVED' &&
    snapshot.openThreads === 0
  )
}

export function isActionable(transition: Transition): boolean {
  return ACTIONABLE.has(transition.kind)
}

/**
 * Unresolved threads opened and resolved between two polls, by thread id. A
 * snapshot stored before ids were kept falls back to comparing counts.
 */
function threadChange(previous: SentrySnapshot, next: SentrySnapshot): { opened: number; resolved: number } {
  const before = Array.isArray(previous.openThreadIds) ? previous.openThreadIds : null
  const after = Array.isArray(next.openThreadIds) ? next.openThreadIds : null
  if (before === null || after === null) {
    const delta = next.openThreads - previous.openThreads
    return { opened: Math.max(0, delta), resolved: Math.max(0, -delta) }
  }
  const was = new Set(before)
  const now = new Set(after)
  return {
    opened: after.filter(id => !was.has(id)).length,
    resolved: before.filter(id => !now.has(id)).length,
  }
}

/**
 * What changed between two polls of one PR. The first observation is a
 * baseline (no transitions), so a state is reported once, when it is entered.
 */
export function transitions(previous: SentrySnapshot | null, next: SentrySnapshot): Transition[] {
  if (previous === null) return []
  if (next.state === 'MERGED') return previous.state === 'MERGED' ? [] : [{ kind: 'merged' }]
  if (next.state === 'CLOSED') return previous.state === 'CLOSED' ? [] : [{ kind: 'closed' }]

  const found: Transition[] = []
  const sameHead = previous.headSha === next.headSha
  const ready = isReady(next)

  if (!sameHead) found.push({ kind: 'head-moved' })

  if (next.ci === 'failed') {
    if (!(sameHead && previous.ci === 'failed')) found.push({ kind: 'ci-failed' })
  } else if (sameHead && previous.ci !== next.ci) {
    if (next.ci === 'green') {
      if (!ready) found.push({ kind: 'ci-green' })
    } else {
      found.push({ kind: 'ci-running' })
    }
  }

  if (ready && !(sameHead && isReady(previous))) found.push({ kind: 'ready' })

  if (previous.reviewDecision !== next.reviewDecision) {
    if (next.reviewDecision === 'CHANGES_REQUESTED') found.push({ kind: 'changes-requested' })
    else if (next.reviewDecision === 'APPROVED') {
      if (!ready) found.push({ kind: 'approved' })
    } else found.push({ kind: 'review-changed' })
  }

  const threads = threadChange(previous, next)
  if (threads.opened > 0) found.push({ kind: 'new-thread', delta: threads.opened })
  if (threads.resolved > 0) found.push({ kind: 'threads-resolved' })

  if (next.isInMergeQueue !== previous.isInMergeQueue) {
    found.push({ kind: next.isInMergeQueue ? 'queued' : 'dequeued' })
  }
  return found
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 'S'}`
}

function wakePhrase(snapshot: SentrySnapshot, transition: Transition): string | null {
  const sha = shortSha(snapshot.headSha)
  switch (transition.kind) {
    case 'ci-failed':
      return snapshot.failedChecks.length > 0
        ? `CI FAILED on ${sha} — failed checks: ${checkList(snapshot.failedChecks)}. Investigate.`
        : `CI FAILED on ${sha}. Investigate.`
    case 'ready':
      return `READY on ${sha} — CI green, approved, no open threads.`
    case 'changes-requested':
      return 'CHANGES REQUESTED — address the review.'
    case 'new-thread':
      return `${plural(snapshot.openThreads, 'OPEN THREAD')} (+${transition.delta ?? 1} new) — address them.`
    case 'merged':
      return 'MERGED. Watch ended.'
    case 'closed':
      return 'CLOSED without merging. Watch ended.'
    default:
      return null
  }
}

/** The one-line prompt that wakes the session, or null when nothing is actionable. */
export function wakeLine(snapshot: SentrySnapshot, found: readonly Transition[]): string | null {
  const phrases = found.map(one => wakePhrase(snapshot, one)).filter((one): one is string => one !== null)
  return phrases.length === 0 ? null : `SENTRY: PR #${snapshot.number} ${phrases.join(' ')}`
}

const TOAST_LABEL: Record<TransitionKind, string> = {
  'ci-failed': 'CI FAILED',
  ready: 'READY!',
  'changes-requested': 'CHANGES REQUESTED',
  'new-thread': 'NEW THREAD',
  merged: 'MERGED',
  closed: 'CLOSED',
  'ci-green': 'CI GREEN',
  'ci-running': 'CI RUNNING',
  'head-moved': 'NEW HEAD, CI RESET',
  approved: 'APPROVED',
  'review-changed': 'REVIEW CHANGED',
  'threads-resolved': 'THREAD RESOLVED',
  queued: 'IN MERGE QUEUE',
  dequeued: 'LEFT MERGE QUEUE',
}

/** The toast for one poll's transitions of one PR. */
export function toastText(snapshot: SentrySnapshot, found: readonly Transition[]): string {
  return `SENTRY #${snapshot.number} ${found.map(one => TOAST_LABEL[one.kind]).join(' / ')}`
}

export function levelOf(snapshot: SentrySnapshot): Level {
  if (snapshot.state !== 'OPEN') return 'done'
  if (snapshot.ci === 'failed') return 'failed'
  if (snapshot.reviewDecision === 'CHANGES_REQUESTED' || snapshot.openThreads > 0) return 'attention'
  if (isReady(snapshot)) return 'ready'
  return 'waiting'
}

/** The worst level over every watched PR (an error counts as `error`). */
export function worstLevel(snapshots: readonly SentrySnapshot[], hasError = false): Level {
  const levels: Level[] = snapshots.map(levelOf)
  if (hasError) levels.push('error')
  let worst: Level = 'idle'
  for (const level of levels) if (LEVEL_ORDER.indexOf(level) < LEVEL_ORDER.indexOf(worst)) worst = level
  return worst
}

const CI_GLYPH: Record<SentryCi, string> = { green: '▓', running: '▒', pending: '░', failed: 'X' }

function reviewGlyph(decision: string): string {
  return decision === 'APPROVED' ? '▓' : decision === 'CHANGES_REQUESTED' ? 'X' : '░'
}

/** The status line for the worst PR, e.g. `SENTRY #12 CI▓ REV░ 0T +1`. */
export function statusLine(snapshots: readonly SentrySnapshot[], error: string | null): string | undefined {
  if (snapshots.length === 0) return error === null ? undefined : 'SENTRY ERR: SEE /watch'
  const worst = [...snapshots].sort(
    (a, b) => LEVEL_ORDER.indexOf(levelOf(a)) - LEVEL_ORDER.indexOf(levelOf(b)),
  )[0] as SentrySnapshot
  const more = snapshots.length > 1 ? ` +${snapshots.length - 1}` : ''
  const flag = error === null ? '' : ' ERR'
  if (worst.state !== 'OPEN') return `SENTRY #${worst.number} ${worst.state}${more}${flag}`
  return `SENTRY #${worst.number} CI${worst.ciError != null ? '?' : CI_GLYPH[worst.ci]} REV${reviewGlyph(worst.reviewDecision)} ${worst.openThreads}T${more}${flag}`
}

/** A one-line text summary of a snapshot, for command replies and `pr_state`. */
export function summaryLine(snapshot: SentrySnapshot): string {
  const ci =
    snapshot.ciError != null
      ? `CI UNKNOWN (check-runs unreadable: ${snapshot.ciError})`
      : snapshot.ci === 'failed'
      ? `CI FAILED (${snapshot.failedChecks.length > 0 ? checkList(snapshot.failedChecks) : 'unnamed'})`
      : snapshot.ci === 'green'
        ? `CI GREEN (${snapshot.checkCount} checks)`
        : snapshot.ci === 'running'
          ? `CI RUNNING (${snapshot.runningChecks}/${snapshot.checkCount} left)`
          : 'CI PENDING (no check-runs yet)'
  const review = snapshot.reviewDecision === '' ? 'NO REVIEW DECISION' : snapshot.reviewDecision.replaceAll('_', ' ')
  const queue = snapshot.isInMergeQueue ? ', IN MERGE QUEUE' : ''
  return `PR #${snapshot.number} ${snapshot.state} on ${shortSha(snapshot.headSha)}: ${ci}, ${review}, ${plural(snapshot.openThreads, 'OPEN THREAD')}${queue}${isReady(snapshot) ? ' — READY' : ''}`
}
