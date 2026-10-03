import { describe, expect, test } from 'claude-code/testing'

import {
  checkRunsArgv,
  describeGhFailure,
  describeSpawnFailure,
  parseJson,
  parsePrRef,
  prQueryArgv,
  readCheckRunsPage,
  readPullRequest,
} from '../hooks/gh'

describe('parsePrRef', () => {
  test('numbers, #numbers, URLs and owner/repo#n', () => {
    expect(parsePrRef('12')).toEqual({ number: 12, repo: null })
    expect(parsePrRef(' #42 ')).toEqual({ number: 42, repo: null })
    expect(parsePrRef('https://github.com/acme/app/pull/7')).toEqual({ number: 7, repo: 'acme/app' })
    expect(parsePrRef('https://github.com/acme/app/pull/7/files')).toEqual({ number: 7, repo: 'acme/app' })
    expect(parsePrRef('acme/app#9')).toEqual({ number: 9, repo: 'acme/app' })
  })

  test('anything else is null', () => {
    expect(parsePrRef('')).toBeNull()
    expect(parsePrRef('abc')).toBeNull()
    expect(parsePrRef('0')).toBeNull()
    expect(parsePrRef('https://example.com/acme/app/issues/7')).toBeNull()
  })
})

describe('argv', () => {
  test('the PR query is one GraphQL call with owner, name and number', () => {
    const argv = prQueryArgv('acme/app', 12, null)
    expect(argv.slice(0, 3)).toEqual(['gh', 'api', 'graphql'])
    expect(argv).toContain('owner=acme')
    expect(argv).toContain('name=app')
    expect(argv).toContain('number=12')
    const query = argv.find(one => one.startsWith('query=')) ?? ''
    for (const field of ['headRefOid', 'mergeStateStatus', 'reviewDecision', 'isInMergeQueue', 'mergedAt', 'title', 'state', 'isResolved']) {
      expect(query).toContain(field)
    }
    expect(prQueryArgv('acme/app', 12, 'CUR')).toContain('after=CUR')
  })

  test('check-runs are read for the head SHA, 100 per page', () => {
    expect(checkRunsArgv('acme/app', 'abc', 2)).toEqual([
      'gh',
      'api',
      'repos/acme/app/commits/abc/check-runs?per_page=100&page=2',
    ])
  })
})

describe('parseJson', () => {
  test('tolerates raw control characters inside strings', () => {
    expect(parseJson('{"a":"line\u0001one\ttwo"}')).toEqual({ a: 'line one two' })
  })

  test('garbage is null', () => {
    expect(parseJson('not json')).toBeNull()
  })
})

describe('readPullRequest', () => {
  const page = {
    data: {
      repository: {
        pullRequest: {
          number: 12,
          title: 'T',
          url: 'u',
          state: 'OPEN',
          headRefOid: 'abc',
          mergeStateStatus: 'CLEAN',
          reviewDecision: null,
          isInMergeQueue: false,
          mergedAt: null,
          reviewThreads: {
            pageInfo: { hasNextPage: true, endCursor: 'C1' },
            nodes: [{ id: 'A', isResolved: false }, { id: 'B', isResolved: true }, { id: 'C', isResolved: false }],
          },
        },
      },
    },
  }

  test('reads the PR, counts unresolved threads and the next page', () => {
    const read = readPullRequest(page)
    expect(read).toMatchObject({ pr: { number: 12, headRefOid: 'abc' }, unresolvedIds: ['A', 'C'], nextCursor: 'C1' })
  })

  test('a missing PR is an error', () => {
    expect(readPullRequest({ data: { repository: { pullRequest: null } } })).toEqual({ error: 'not found' })
    expect(readPullRequest(null)).toEqual({ error: 'unreadable gh output' })
  })
})

describe('readCheckRunsPage', () => {
  test('reads runs and the total', () => {
    expect(
      readCheckRunsPage({ total_count: 1, check_runs: [{ name: 'lint', status: 'completed', conclusion: 'success', output: {} }] }),
    ).toEqual({ total: 1, runs: [{ name: 'lint', status: 'completed', conclusion: 'success' }] })
    expect(readCheckRunsPage({})).toBeNull()
  })
})

describe('failures', () => {
  test('an unauthenticated gh says how to fix it', () => {
    expect(describeGhFailure('To get started with GitHub CLI, please run:  gh auth login')).toContain('gh auth login')
    expect(describeGhFailure('HTTP 401: Bad credentials')).toContain('gh auth login')
  })

  test('a missing gh says to install it', () => {
    expect(describeSpawnFailure('spawn gh ENOENT')).toContain('GitHub CLI')
    expect(describeSpawnFailure('spawn gh ENOENT', 5, 30_000)).toContain('GitHub CLI')
  })

  test('a gh that timed out says so and does not ask to install it', () => {
    const byClock = describeSpawnFailure('process killed', 30_000, 30_000)
    expect(byClock).toBe('gh timed out after 30s (network?); sentry will try again next poll.')
    expect(describeSpawnFailure('Command timed out after 30000ms')).toContain('timed out')
    expect(describeSpawnFailure('Command timed out after 30000ms')).not.toContain('install')
  })

  test('anything else keeps the first line', () => {
    expect(describeGhFailure('boom\nmore')).toBe('gh failed: boom')
    expect(describeGhFailure('')).toBe('gh failed with no message')
  })
})
