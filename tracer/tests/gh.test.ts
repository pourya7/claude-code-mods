import { describe, expect, test } from 'claude-code/testing'

import {
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
} from '../hooks/gh'

const SHA = 'abc1234def5678abc1234def5678abc1234def56'

describe('parseTraceRef', () => {
  test('PR numbers, slugs and URLs', () => {
    expect(parseTraceRef('42')).toEqual({ kind: 'pr', number: 42, repo: null })
    expect(parseTraceRef('#42')).toEqual({ kind: 'pr', number: 42, repo: null })
    expect(parseTraceRef('acme/app#42')).toEqual({ kind: 'pr', number: 42, repo: 'acme/app' })
    expect(parseTraceRef('https://github.com/acme/app/pull/42/files')).toEqual({ kind: 'pr', number: 42, repo: 'acme/app' })
  })

  test('SHAs, owner/repo@sha and commit URLs', () => {
    expect(parseTraceRef('abc1234')).toEqual({ kind: 'sha', sha: 'abc1234', repo: null })
    expect(parseTraceRef(SHA.toUpperCase())).toEqual({ kind: 'sha', sha: SHA, repo: null })
    expect(parseTraceRef('acme/app@abc1234')).toEqual({ kind: 'sha', sha: 'abc1234', repo: 'acme/app' })
    expect(parseTraceRef(`https://github.com/acme/app/commit/${SHA}`)).toEqual({ kind: 'sha', sha: SHA, repo: 'acme/app' })
  })

  test('anything else is null', () => {
    for (const bad of ['', 'abc', 'main', '0', 'xyz1234', 'abc12345678901234567890123456789012345678901', 'acme/app#x']) {
      expect(parseTraceRef(bad)).toBeNull()
    }
  })
})

describe('argv', () => {
  test('each gh call', () => {
    expect(prViewArgv('acme/app', 42)).toEqual(['gh', 'pr', 'view', '42', '--repo', 'acme/app', '--json', 'number,title,state,mergeCommit'])
    expect(commitArgv('acme/app', 'abc1234')).toEqual(['gh', 'api', 'repos/acme/app/commits/abc1234'])
    expect(runsArgv('acme/app', SHA)).toEqual(['gh', 'api', `repos/acme/app/actions/runs?head_sha=${SHA}&per_page=100`])
    expect(deploymentsArgv('acme/app', SHA)).toEqual(['gh', 'api', `repos/acme/app/deployments?sha=${SHA}&per_page=100`])
    expect(deploymentStatusArgv('acme/app', 7)).toEqual(['gh', 'api', 'repos/acme/app/deployments/7/statuses?per_page=1'])
  })
})

describe('readers', () => {
  test('readPrView: merged, not merged, unreadable', () => {
    expect(readPrView({ number: 42, title: 'Add login retry', state: 'MERGED', mergeCommit: { oid: SHA } })).toEqual({
      number: 42,
      title: 'Add login retry',
      state: 'MERGED',
      mergeSha: SHA,
    })
    expect(readPrView({ number: 42, title: 't', state: 'OPEN', mergeCommit: null })).toEqual({ number: 42, title: 't', state: 'OPEN', mergeSha: null })
    expect(readPrView(null)).toBeNull()
  })

  test('readCommit takes the full SHA and the first line of the message', () => {
    expect(readCommit({ sha: SHA, commit: { message: 'Fix the thing (#42)\n\nbody' } })).toEqual({ sha: SHA, title: 'Fix the thing (#42)' })
    expect(readCommit({ message: 'Not Found' })).toBeNull()
  })

  test('readRuns', () => {
    expect(readRuns({ total_count: 1, workflow_runs: [{ name: 'ci', status: 'completed', conclusion: 'success', id: 1 }] })).toEqual([
      { name: 'ci', status: 'completed', conclusion: 'success' },
    ])
    expect(readRuns({})).toBeNull()
  })

  test('readDeployments', () => {
    expect(readDeployments([{ id: 7, environment: 'production', created_at: '2026-10-01T10:00:00Z', sha: SHA }])).toEqual([
      { id: 7, environment: 'production', createdAt: '2026-10-01T10:00:00Z' },
    ])
    expect(readDeployments({ message: 'Not Found' })).toBeNull()
  })

  test('readLatestStatus: newest first, none yet, unreadable', () => {
    expect(readLatestStatus([{ state: 'success' }, { state: 'in_progress' }])).toEqual({ state: 'success' })
    expect(readLatestStatus([])).toEqual({ state: null })
    expect(readLatestStatus({})).toBeNull()
  })

  test('parseJson survives control characters and garbage', () => {
    expect(parseJson('{"a":"x\u0001y"}')).toEqual({ a: 'x y' })
    expect(parseJson('not json')).toBeNull()
  })
})

describe('failures', () => {
  test('unauthenticated gh gets the fix', () => {
    expect(describeGhFailure('To get started with GitHub CLI, please run:  gh auth login')).toContain('gh auth login')
  })

  test('other gh failures keep the first line', () => {
    expect(describeGhFailure('HTTP 404: Not Found\nmore')).toBe('gh failed: HTTP 404: Not Found')
    expect(describeGhFailure('')).toBe('gh failed with no message')
  })

  test('missing gh and timeouts', () => {
    expect(describeSpawnFailure('spawn gh ENOENT')).toContain('install the GitHub CLI')
    expect(describeSpawnFailure('anything', 30_000, 30_000)).toContain('timed out after 30s')
  })
})
