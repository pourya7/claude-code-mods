import { describe, expect, test } from 'claude-code/testing'

import type { PartyMember } from '../types'
import {
  STALE_MS,
  addTouch,
  basename,
  broadcastTargets,
  formatAge,
  isMember,
  liveMembers,
  lockReason,
  nagDue,
  nagKey,
  otherTouch,
  prTarget,
  repoFromRemote,
  splitCommands,
  staleKeys,
  statusLine,
  titleFrom,
  waitBar,
  waitKind,
  withState,
} from '../hooks/party'

const NOW = 1_000_000_000

function member(over: Partial<PartyMember> = {}): PartyMember {
  return {
    sessionId: 'me',
    title: 'fix the login page',
    cwd: '/work/app',
    branch: 'main',
    repo: 'example/app',
    state: 'idle',
    since: NOW,
    waitingFor: null,
    lastTool: '',
    beatAt: NOW,
    touches: [],
    ...over,
  }
}

describe('members and staleness', () => {
  test('isMember accepts a heartbeat and rejects junk', () => {
    expect(isMember(member())).toBe(true)
    expect(isMember({ sessionId: 'x' })).toBe(false)
    expect(isMember(null)).toBe(false)
    expect(isMember({ ...member(), state: 'dancing' })).toBe(false)
  })

  test('entries older than 2 minutes are dropped from the view', () => {
    const fresh = member({ sessionId: 'a', beatAt: NOW - STALE_MS })
    const stale = member({ sessionId: 'b', beatAt: NOW - STALE_MS - 1 })
    expect(liveMembers([fresh, stale, 'junk'], NOW).map(one => one.sessionId)).toEqual(['a'])
  })

  test('staleKeys names stale and unreadable session entries, never other keys', () => {
    const entries = {
      'session:a': member({ sessionId: 'a' }),
      'session:b': member({ sessionId: 'b', beatAt: NOW - STALE_MS - 1 }),
      'session:c': 'junk',
      other: 1,
    }
    expect(staleKeys(entries, NOW)).toEqual(['session:b', 'session:c'])
  })

  test('the view puts waiting sessions first, longest wait first', () => {
    const idle = member({ sessionId: 'idle', state: 'idle' })
    const working = member({ sessionId: 'working', state: 'working' })
    const waitedLong = member({ sessionId: 'long', state: 'waiting-on-you', since: NOW - 600_000 })
    const waitedShort = member({ sessionId: 'short', state: 'waiting-on-you', since: NOW - 60_000 })
    const order = liveMembers([idle, waitedShort, working, waitedLong], NOW).map(one => one.sessionId)
    expect(order).toEqual(['long', 'short', 'working', 'idle'])
  })
})

describe('state transitions', () => {
  test('a new state restarts the clock, the same state keeps it', () => {
    const working = withState(member({ state: 'idle', since: 5 }), 'working', NOW)
    expect(working.state).toBe('working')
    expect(working.since).toBe(NOW)
    expect(withState(working, 'working', NOW + 9).since).toBe(NOW)
  })

  test('waiting records what it waits for, other states clear it', () => {
    const waiting = withState(member(), 'waiting-on-you', NOW, 'question')
    expect(waiting.waitingFor).toBe('question')
    expect(withState(waiting, 'working', NOW).waitingFor).toBeNull()
  })

  test('waitKind maps the tools that wait on a person', () => {
    expect(waitKind('AskUserQuestion')).toBe('question')
    expect(waitKind('ExitPlanMode')).toBe('plan')
    expect(waitKind('Bash')).toBeNull()
  })
})

describe('PR targets', () => {
  test('splitCommands splits on separators and keeps quoted words whole', () => {
    expect(splitCommands(`cd /x && gh pr comment 42 --body "a; b" | cat`)).toEqual([
      ['cd', '/x'],
      ['gh', 'pr', 'comment', '42', '--body', 'a; b'],
      ['cat'],
    ])
  })

  test('each lock verb with a number targets the session repo', () => {
    for (const verb of ['merge', 'close', 'comment', 'review', 'edit']) {
      expect(prTarget(`gh pr ${verb} 42`, 'example/app')).toEqual({ repo: 'example/app', pr: 42 })
    }
  })

  test('flags before the selector are skipped, values included', () => {
    expect(prTarget('gh pr merge --squash --delete-branch 42', 'example/app')).toEqual({ repo: 'example/app', pr: 42 })
    expect(prTarget('gh pr comment --body 7 42', 'example/app')).toEqual({ repo: 'example/app', pr: 42 })
    expect(prTarget('gh pr review -R other/lib --approve #9', 'example/app')).toEqual({ repo: 'other/lib', pr: 9 })
    expect(prTarget('gh pr edit 3 --repo=other/lib', 'example/app')).toEqual({ repo: 'other/lib', pr: 3 })
  })

  test('a flag is read as a boolean only for the verb where gh takes no value for it', () => {
    const at42 = { repo: 'example/app', pr: 42 }
    expect(prTarget('gh pr close --comment "superseded by #43" 42', 'example/app')).toEqual(at42)
    expect(prTarget('gh pr close -c bye -d 42', 'example/app')).toEqual(at42)
    expect(prTarget('gh pr edit -m v2 42', 'example/app')).toEqual(at42)
    expect(prTarget('gh pr edit --remove-milestone 42', 'example/app')).toEqual(at42)
    expect(prTarget('gh pr merge -m 42', 'example/app')).toEqual(at42)
    expect(prTarget('gh pr review -c 42 -b hi', 'example/app')).toEqual(at42)
  })

  test('a PR URL names its own repo', () => {
    expect(prTarget('gh pr merge https://github.com/other/lib/pull/12 --squash', 'example/app')).toEqual({
      repo: 'other/lib',
      pr: 12,
    })
    expect(prTarget('gh pr close https://github.com/other/lib/pull/12', null)).toEqual({ repo: 'other/lib', pr: 12 })
  })

  test('reads, other verbs and selector-less calls are not locks', () => {
    expect(prTarget('gh pr view 42', 'example/app')).toBeNull()
    expect(prTarget('gh pr checks 42', 'example/app')).toBeNull()
    expect(prTarget('gh pr merge --squash', 'example/app')).toBeNull()
    expect(prTarget('echo gh pr merge 42', 'example/app')).toBeNull()
    expect(prTarget('gh pr merge 42', null)).toBeNull()
  })

  test('a lock verb later in a chain still counts', () => {
    expect(prTarget('git push && gh pr merge 5 --squash', 'example/app')).toEqual({ repo: 'example/app', pr: 5 })
  })

  test('repoFromRemote reads ssh and https GitHub remotes', () => {
    expect(repoFromRemote('git@github.com:example/app.git')).toBe('example/app')
    expect(repoFromRemote('https://github.com/example/app')).toBe('example/app')
    expect(repoFromRemote('ssh://git@github.com/example/app.git')).toBe('example/app')
    expect(repoFromRemote('https://git.example.com/app.git')).toBeNull()
    expect(repoFromRemote(null)).toBeNull()
  })
})

describe('locks', () => {
  const target = { repo: 'example/app', pr: 42 }
  const lockMs = 10 * 60_000

  test('another live session touching the PR inside the window is found', () => {
    const other = member({ sessionId: 'other', touches: [{ ...target, at: NOW - 60_000 }] })
    expect(otherTouch([member(), other], 'me', target, NOW, lockMs)?.member.sessionId).toBe('other')
  })

  test('no lock for this same session, an old touch, or another PR', () => {
    const mine = member({ touches: [{ ...target, at: NOW }] })
    const old = member({ sessionId: 'old', touches: [{ ...target, at: NOW - lockMs - 1 }] })
    const elsewhere = member({ sessionId: 'elsewhere', touches: [{ repo: 'example/app', pr: 43, at: NOW }] })
    expect(otherTouch([mine, old, elsewhere], 'me', target, NOW, lockMs)).toBeNull()
  })

  test('addTouch keeps one entry per PR and drops expired ones', () => {
    const touches = addTouch([{ ...target, at: NOW - lockMs - 5 }, { repo: 'x/y', pr: 1, at: NOW - 5 }], target, NOW, lockMs)
    expect(touches).toEqual([{ repo: 'x/y', pr: 1, at: NOW - 5 }, { ...target, at: NOW }])
    expect(addTouch(touches, target, NOW + 1, lockMs).filter(one => one.pr === 42)).toEqual([{ ...target, at: NOW + 1 }])
  })

  test('the lock reason names the other session and when', () => {
    const other = member({ sessionId: 'other', title: 'ship the release', cwd: '/work/app-two', branch: 'feat/x' })
    const text = lockReason(other, { ...target, at: NOW - 180_000 }, NOW)
    expect(text).toContain('example/app#42')
    expect(text).toContain('ship the release')
    expect(text).toContain('app-two@feat/x')
    expect(text).toContain('3M AGO')
  })
})

describe('waiting', () => {
  test('the wait bar fills over nagMinutes, then turns red', () => {
    const nagMs = 5 * 60_000
    expect(waitBar(0, nagMs, 10)).toEqual({ filled: 0, color: 'lime' })
    expect(waitBar(nagMs / 2, nagMs, 10)).toEqual({ filled: 5, color: 'yellow' })
    expect(waitBar(nagMs, nagMs, 10)).toEqual({ filled: 10, color: 'red' })
    expect(waitBar(nagMs * 3, nagMs, 10)).toEqual({ filled: 10, color: 'red' })
  })

  test('nagDue names other sessions past nagMinutes that were not toasted yet', () => {
    const nagMs = 5 * 60_000
    const me = member({ state: 'waiting-on-you', since: NOW - nagMs * 2 })
    const late = member({ sessionId: 'late', state: 'waiting-on-you', since: NOW - nagMs - 1 })
    const early = member({ sessionId: 'early', state: 'waiting-on-you', since: NOW - 1000 })
    const working = member({ sessionId: 'working', state: 'working', since: 0 })
    expect(nagDue([me, late, early, working], 'me', NOW, nagMs, []).map(one => one.sessionId)).toEqual(['late'])
    expect(nagDue([late], 'me', NOW, nagMs, [nagKey(late)])).toEqual([])
  })

  test('status line counts the party and the waiting, under 40 columns', () => {
    const line = statusLine([
      member({ state: 'working' }),
      member({ sessionId: 'b', state: 'waiting-on-you' }),
      member({ sessionId: 'c' }),
      member({ sessionId: 'd' }),
    ])
    expect(line).toBe('PARTY 4 ▸ 1 WAITING')
    expect(line.length).toBeLessThan(40)
  })

  test('broadcast targets every live session but this one', () => {
    const list = [member(), member({ sessionId: 'b' }), member({ sessionId: 'c', state: 'done' })]
    expect(broadcastTargets(list, 'me').map(one => one.sessionId)).toEqual(['b'])
  })
})

describe('text helpers', () => {
  test('formatAge reads seconds, minutes and hours', () => {
    expect(formatAge(5_000)).toBe('5S')
    expect(formatAge(6 * 60_000 + 10_000)).toBe('6M')
    expect(formatAge(65 * 60_000)).toBe('1H05')
  })

  test('titleFrom keeps the first line, cut to 40 columns', () => {
    expect(titleFrom('  fix the bug\nand more')).toBe('fix the bug')
    expect(titleFrom('x'.repeat(60))).toHaveLength(40)
    expect(titleFrom('')).toBe('')
  })

  test('basename takes the last path part', () => {
    expect(basename('/work/app/')).toBe('app')
    expect(basename('/')).toBe('/')
  })
})
