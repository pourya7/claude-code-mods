// gh: argv builders, output readers and failure messages. Pure: no `$` here.
import type { CheckRun, PullRequestPayload } from './truth'

export type PrRef = { number: number; repo: string | null }

const URL_REF = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i
const SLUG_REF = /^([\w.-]+\/[\w.-]+)#(\d+)$/
const NUMBER_REF = /^#?(\d+)$/

/** `12`, `#12`, `owner/repo#12` or a PR URL; null for anything else. */
export function parsePrRef(argument: string): PrRef | null {
  const text = argument.trim()
  const url = URL_REF.exec(text)
  const slug = SLUG_REF.exec(text)
  const bare = NUMBER_REF.exec(text)
  const [repo, digits] = url ? [url[1], url[2]] : slug ? [slug[1], slug[2]] : bare ? [null, bare[1]] : [null, undefined]
  const number = Number(digits)
  if (digits === undefined || !Number.isInteger(number) || number <= 0) return null
  return { number, repo: repo ?? null }
}

export const REPO_VIEW_ARGV = ['gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'] as const

const PR_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number title url state headRefOid mergeStateStatus reviewDecision isInMergeQueue mergedAt
      reviewThreads(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { id isResolved } }
    }
  }
}`

/** One GraphQL call: the PR's state and one page of its review threads. */
export function prQueryArgv(repo: string, number: number, after: string | null): string[] {
  const [owner = '', name = ''] = repo.split('/')
  const argv = ['gh', 'api', 'graphql', '-f', `query=${PR_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${number}`]
  if (after !== null) argv.push('-f', `after=${after}`)
  return argv
}

/** One page of the check-runs on a head SHA (the latest run per check). */
export function checkRunsArgv(repo: string, sha: string, page: number): string[] {
  return ['gh', 'api', `repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`]
}

/**
 * JSON.parse that survives the raw control characters GitHub sometimes leaves
 * inside check-run output strings (each becomes a space).
 */
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

function cursorOf(info: unknown): string {
  const cursor = field(info, 'endCursor')
  return typeof cursor === 'string' ? cursor : 'last'
}

export type PullRequestPage =
  | { pr: PullRequestPayload; unresolvedIds: string[]; nextCursor: string | null }
  | { error: string }

export function readPullRequest(json: unknown): PullRequestPage {
  if (typeof json !== 'object' || json === null) return { error: 'unreadable gh output' }
  const pr = field(field(field(json, 'data'), 'repository'), 'pullRequest')
  if (typeof pr !== 'object' || pr === null) return { error: 'not found' }
  const threads = field(pr, 'reviewThreads')
  const nodes = field(threads, 'nodes')
  const info = field(threads, 'pageInfo')
  const unresolvedIds: string[] = []
  if (Array.isArray(nodes)) {
    nodes.forEach((node, index) => {
      if (field(node, 'isResolved') !== false) return
      const id = field(node, 'id')
      unresolvedIds.push(typeof id === 'string' && id !== '' ? id : `unknown-${cursorOf(info)}-${index}`)
    })
  }
  const hasNext = field(info, 'hasNextPage') === true
  const cursor = field(info, 'endCursor')
  return {
    pr: {
      number: Number(field(pr, 'number')),
      title: String(field(pr, 'title') ?? ''),
      url: String(field(pr, 'url') ?? ''),
      state: String(field(pr, 'state') ?? 'OPEN'),
      headRefOid: String(field(pr, 'headRefOid') ?? ''),
      mergeStateStatus: (field(pr, 'mergeStateStatus') as string | null) ?? null,
      reviewDecision: (field(pr, 'reviewDecision') as string | null) ?? null,
      isInMergeQueue: field(pr, 'isInMergeQueue') === true,
      mergedAt: (field(pr, 'mergedAt') as string | null) ?? null,
    },
    unresolvedIds,
    nextCursor: hasNext && typeof cursor === 'string' ? cursor : null,
  }
}

export function readCheckRunsPage(json: unknown): { total: number; runs: CheckRun[] } | null {
  const list = field(json, 'check_runs')
  const total = field(json, 'total_count')
  if (!Array.isArray(list) || typeof total !== 'number') return null
  return {
    total,
    runs: list.map(run => ({
      name: String(field(run, 'name') ?? ''),
      status: String(field(run, 'status') ?? ''),
      conclusion: (field(run, 'conclusion') as string | null) ?? null,
    })),
  }
}

const UNAUTHENTICATED = /gh auth login|not logged in|authentication|bad credentials|HTTP 401|GH_TOKEN/i

/** A gh run that exited non-zero, said in one line. */
export function describeGhFailure(stderr: string): string {
  if (UNAUTHENTICATED.test(stderr)) return 'gh is not authenticated: run `gh auth login`, then /watch again.'
  const first = stderr.trim().split('\n')[0]?.trim() ?? ''
  return first === '' ? 'gh failed with no message' : `gh failed: ${first.slice(0, 200)}`
}

const TIMED_OUT = /timed? ?out|timeout|ETIMEDOUT|still running/i

/**
 * A gh run that rejected: it timed out (ran `elapsedMs` of a `timeoutMs`
 * budget, or says so) or it could not start at all.
 */
export function describeSpawnFailure(message: string, elapsedMs = 0, timeoutMs = Number.POSITIVE_INFINITY): string {
  if (elapsedMs >= timeoutMs || TIMED_OUT.test(message)) {
    const seconds = Number.isFinite(timeoutMs) ? `${Math.round(timeoutMs / 1000)}s` : 'its time limit'
    return `gh timed out after ${seconds} (network?); sentry will try again next poll.`
  }
  return `gh could not run (${message.slice(0, 120)}): install the GitHub CLI (cli.github.com) and put it on PATH.`
}
