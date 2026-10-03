// gh: what /trace accepts, argv builders, output readers and failure
// messages. Pure: no `$` here.
import type { WorkflowRun } from './chain'

export type TraceRef =
  | { kind: 'pr'; number: number; repo: string | null }
  | { kind: 'sha'; sha: string; repo: string | null }

const REPO = String.raw`[\w.-]+\/[\w.-]+`
const PR_URL = new RegExp(String.raw`^(?:https?:\/\/)?(?:www\.)?github\.com\/(${REPO})\/pull\/(\d+)(?:[/?#].*)?$`, 'i')
const COMMIT_URL = new RegExp(String.raw`^(?:https?:\/\/)?(?:www\.)?github\.com\/(${REPO})\/commit\/([0-9a-f]{7,40})(?:[/?#].*)?$`, 'i')
const PR_SLUG = new RegExp(String.raw`^(${REPO})#(\d+)$`)
const SHA_SLUG = new RegExp(String.raw`^(${REPO})@([0-9a-f]{7,40})$`, 'i')
const PR_NUMBER = /^#?(\d+)$/
const SHA = /^[0-9a-f]{7,40}$/i

function prRef(digits: string | undefined, repo: string | null): TraceRef | null {
  const number = Number(digits)
  return Number.isInteger(number) && number > 0 ? { kind: 'pr', number, repo } : null
}

/**
 * `42`, `#42`, `owner/repo#42` or a PR URL (a PR); `abc1234`, `owner/repo@abc1234`
 * or a commit URL (a SHA, 7 to 40 hex characters). All digits reads as a PR.
 */
export function parseTraceRef(argument: string): TraceRef | null {
  const text = argument.trim()
  let match = PR_URL.exec(text) ?? PR_SLUG.exec(text)
  if (match) return prRef(match[2], match[1] ?? null)
  match = PR_NUMBER.exec(text)
  if (match) return prRef(match[1], null)
  match = COMMIT_URL.exec(text) ?? SHA_SLUG.exec(text)
  if (match) return { kind: 'sha', sha: (match[2] ?? '').toLowerCase(), repo: match[1] ?? null }
  if (SHA.test(text)) return { kind: 'sha', sha: text.toLowerCase(), repo: null }
  return null
}

export const REPO_VIEW_ARGV = ['gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'] as const

export function prViewArgv(repo: string, number: number): string[] {
  return ['gh', 'pr', 'view', String(number), '--repo', repo, '--json', 'number,title,state,mergeCommit']
}

export function commitArgv(repo: string, sha: string): string[] {
  return ['gh', 'api', `repos/${repo}/commits/${sha}`]
}

export function runsArgv(repo: string, sha: string): string[] {
  return ['gh', 'api', `repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`]
}

export function deploymentsArgv(repo: string, sha: string): string[] {
  return ['gh', 'api', `repos/${repo}/deployments?sha=${sha}&per_page=100`]
}

/** The newest status of one deployment (GitHub lists them newest first). */
export function deploymentStatusArgv(repo: string, id: number): string[] {
  return ['gh', 'api', `repos/${repo}/deployments/${id}/statuses?per_page=1`]
}

/** JSON.parse that survives raw control characters in strings (each becomes a space). */
export function parseJson(text: string): unknown {
  try {
    // eslint-disable-next-line no-control-regex
    return JSON.parse(text.replace(/[\u0000-\u001f]/g, ' '))
  } catch {
    return null
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
}

export type PrView = { number: number; title: string; state: string; mergeSha: string | null }

export function readPrView(json: unknown): PrView | null {
  const number = field(json, 'number')
  if (typeof number !== 'number') return null
  const oid = field(field(json, 'mergeCommit'), 'oid')
  return {
    number,
    title: String(field(json, 'title') ?? ''),
    state: String(field(json, 'state') ?? ''),
    mergeSha: typeof oid === 'string' && oid !== '' ? oid.toLowerCase() : null,
  }
}

export function readCommit(json: unknown): { sha: string; title: string } | null {
  const sha = field(json, 'sha')
  if (typeof sha !== 'string' || sha === '') return null
  const message = String(field(field(json, 'commit'), 'message') ?? '')
  return { sha: sha.toLowerCase(), title: message.split('\n')[0]?.trim() ?? '' }
}

export function readRuns(json: unknown): WorkflowRun[] | null {
  const list = field(json, 'workflow_runs')
  if (!Array.isArray(list)) return null
  return list.map(run => ({
    name: String(field(run, 'name') ?? ''),
    status: String(field(run, 'status') ?? ''),
    conclusion: (field(run, 'conclusion') as string | null | undefined) ?? null,
  }))
}

export type Deployment = { id: number; environment: string; createdAt: string }

export function readDeployments(json: unknown): Deployment[] | null {
  if (!Array.isArray(json)) return null
  return json.flatMap(item => {
    const id = field(item, 'id')
    if (typeof id !== 'number') return []
    return [{ id, environment: String(field(item, 'environment') ?? 'unknown'), createdAt: String(field(item, 'created_at') ?? '') }]
  })
}

export function readLatestStatus(json: unknown): { state: string | null } | null {
  if (!Array.isArray(json)) return null
  const state = field(json[0], 'state')
  return { state: typeof state === 'string' ? state : null }
}

const UNAUTHENTICATED = /gh auth login|not logged in|authentication|bad credentials|HTTP 401|GH_TOKEN/i

/** A gh run that exited non-zero, said in one line. */
export function describeGhFailure(stderr: string): string {
  if (UNAUTHENTICATED.test(stderr)) return 'gh is not authenticated: run `gh auth login`, then /trace again.'
  const first = stderr.trim().split('\n')[0]?.trim() ?? ''
  return first === '' ? 'gh failed with no message' : `gh failed: ${first.slice(0, 200)}`
}

const TIMED_OUT = /timed? ?out|timeout|ETIMEDOUT|still running/i

/** A gh run that rejected: it timed out, or it could not start at all. */
export function describeSpawnFailure(message: string, elapsedMs = 0, timeoutMs = Number.POSITIVE_INFINITY): string {
  if (elapsedMs >= timeoutMs || TIMED_OUT.test(message)) {
    const seconds = Number.isFinite(timeoutMs) ? `${Math.round(timeoutMs / 1000)}s` : 'its time limit'
    return `gh timed out after ${seconds} (network?); tracer will try again next poll.`
  }
  return `gh could not run (${message.slice(0, 120)}): install the GitHub CLI (cli.github.com) and put it on PATH.`
}
