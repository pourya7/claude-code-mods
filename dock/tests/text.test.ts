import { describe, expect, test } from 'claude-code/testing'

import type { DockSnapshot } from '../types'
import { markOrphans, readStacks } from '../hooks/docker'
import { gib, guardReason, hereDir, isHere, isLowFuel, shortenPath, summaryText } from '../hooks/text'
import { COMPOSE_LS_JSON, GIB, PS_LINES, STATS_LINES } from './fixtures'

const snapshot = (usedBytes = 5 * GIB): DockSnapshot => {
  const { stacks } = readStacks(COMPOSE_LS_JSON, PS_LINES, STATS_LINES)
  return {
    health: 'ok',
    message: '',
    checkedAt: 0,
    totalBytes: 8 * GIB,
    usedBytes,
    stacks: markOrphans(stacks, new Set(['/work/app/.worktrees/feature-x'])),
  }
}

describe('numbers', () => {
  test('GiB with one decimal', () => {
    expect(gib(2.5 * GIB)).toBe('2.5')
    expect(gib(0)).toBe('0.0')
    expect(gib(12.04 * GIB)).toBe('12.0')
  })
})

describe('low fuel', () => {
  test('below the minimum headroom only', () => {
    expect(isLowFuel(snapshot(5.5 * GIB), 3)).toBe(true)
    expect(isLowFuel(snapshot(5 * GIB), 3)).toBe(false)
    expect(isLowFuel(snapshot(4 * GIB), 3)).toBe(false)
  })

  test('never while docker is unreadable', () => {
    expect(isLowFuel({ ...snapshot(8 * GIB), health: 'daemon-down' }, 3)).toBe(false)
  })
})

describe('guard reason', () => {
  test('names the headroom, the minimum and the biggest stacks with their down command', () => {
    const reason = guardReason(snapshot(6 * GIB), 3)
    expect(reason).toContain('2.0 GiB free of 8.0 GiB')
    expect(reason).toContain('3 GiB')
    expect(reason).toContain('feature-x 2.5 GiB (ORPHAN)')
    expect(reason).toContain('app 2.0 GiB')
    expect(reason).toContain('docker compose -p feature-x down')
    expect(reason).not.toContain('api ')
  })
})

describe('summary', () => {
  test('one line per stack, ORPHAN for a gone worktree, and a hint to free one', () => {
    const text = summaryText(snapshot(), 3)
    expect(text).toContain('5.0 of 8.0 GiB used')
    expect(text).toContain('3.0 GiB headroom')
    expect(text).toMatch(/feature-x\s+UP 1 OFF 1\s+2\.5 GiB\s+ORPHAN/)
    expect(text).toMatch(/app\s+UP 2\s+2\.0 GiB\s+\/work\/app/)
    expect(text).toContain('docker compose -p feature-x down')
  })

  test('says when docker is not there', () => {
    const down: DockSnapshot = { ...snapshot(), health: 'no-docker', message: 'docker could not run', stacks: [] }
    expect(summaryText(down, 3)).toContain('NO DOCKER')
    const daemon: DockSnapshot = { ...snapshot(), health: 'daemon-down', message: 'Cannot connect', stacks: [] }
    expect(summaryText(daemon, 3)).toContain('DAEMON DOWN')
  })

  test('says when there are no stacks', () => {
    expect(summaryText({ ...snapshot(), stacks: [] }, 3)).toContain('NO STACKS')
  })
})

describe('paths', () => {
  test('long paths keep their tail', () => {
    expect(shortenPath('/work/app', 20)).toBe('/work/app')
    const short = shortenPath('/a/very/long/path/to/a/worktree', 16)
    expect(short).toHaveLength(16)
    expect(short.startsWith('..')).toBe(true)
    expect(short.endsWith('/to/a/worktree')).toBe(true)
  })

  test('a stack is here when its working dir is the session cwd or above it', () => {
    expect(isHere('/work/app', '/work/app')).toBe(true)
    expect(isHere('/work/app', '/work/app/src')).toBe(true)
    expect(isHere('/work/app', '/work/application')).toBe(false)
    expect(isHere(null, '/work/app')).toBe(false)
  })

  test('only the deepest working dir holding the cwd is here: a nested worktree, not its main checkout', () => {
    const dirs = ['/work/app', '/work/app/.worktrees/feature-x', '/work/api', null]
    expect(hereDir(dirs, '/work/app/.worktrees/feature-x')).toBe('/work/app/.worktrees/feature-x')
    expect(hereDir(dirs, '/work/app/.worktrees/feature-x/src')).toBe('/work/app/.worktrees/feature-x')
    expect(hereDir(dirs, '/work/app/src')).toBe('/work/app')
    expect(hereDir(dirs, '/elsewhere')).toBeNull()
  })
})
