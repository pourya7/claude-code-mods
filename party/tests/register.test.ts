import { describe, expect, test } from 'claude-code/testing'

import type { Engine } from 'claude-code/testing'

import { NOW, SELF, other, selfEntry, start, turnEnd, turnStart, world } from './world'
import type { World } from './world'

const STALE = 2 * 60_000

/** Core's permission decision for the running Bash call `command`, as the engine raises it inside that call. */
async function decide($: Engine, w: World, command: string) {
  await $.tool.check({ tool: 'Bash', input: { command }, tool_use_id: w.ids[command] } as never)
}

describe('heartbeat', () => {
  test('session start writes this session into the store with cwd, branch and repo', async ($, on) => {
    const w = world(on)
    await start($)
    expect(selfEntry(w)).toMatchObject({
      sessionId: SELF,
      cwd: '/work/app',
      branch: 'feat/login',
      repo: 'example/app',
      state: 'idle',
      beatAt: NOW,
    })
    expect(w.statuses.at(-1)).toBe('PARTY 1 ▸ 0 WAITING')
  })

  test('it beats again every 15 seconds', async ($, on) => {
    const w = world(on)
    await start($)
    await w.clock.advance(15_000)
    expect(selfEntry(w)?.beatAt).toBe(NOW + 15_000)
    await w.clock.advance(15_000)
    expect(selfEntry(w)?.beatAt).toBe(NOW + 30_000)
  })

  test('other live sessions count; stale ones are dropped from the view and the store', async ($, on) => {
    const w = world(on, {
      'session:live': other({ sessionId: 'live', state: 'waiting-on-you', since: NOW - 1000 }),
      'session:stale': other({ sessionId: 'stale', beatAt: NOW - STALE - 1 }),
      'unrelated': 7,
    })
    await start($)
    expect(w.statuses.at(-1)).toBe('PARTY 2 ▸ 1 WAITING')
    expect('session:stale' in w.store).toBe(false)
    expect(w.store.unrelated).toBe(7)
    const reply = await $.command.run({ command: 'party' } as never)
    expect(reply.text).toContain('ship the release')
    expect(reply.text).not.toContain('stale')
  })

  test('a session that stops beating goes stale after 2 minutes', async ($, on) => {
    const w = world(on, { 'session:quiet': other({ sessionId: 'quiet' }) })
    await start($)
    expect(w.statuses.at(-1)).toBe('PARTY 2 ▸ 0 WAITING')
    await w.clock.advance(STALE + 15_000)
    expect(w.statuses.at(-1)).toBe('PARTY 1 ▸ 0 WAITING')
  })
})

describe('state transitions', () => {
  test('turn start is working, with the prompt as the title; turn end is idle', async ($, on) => {
    const w = world(on)
    await start($)
    await turnStart($, 'fix the login page\nmore detail')
    expect(selfEntry(w)).toMatchObject({ state: 'working', title: 'fix the login page', since: NOW })
    await w.clock.advance(5_000)
    await turnEnd($)
    expect(selfEntry(w)).toMatchObject({ state: 'idle', since: NOW + 5_000 })
  })

  test('the title is kept from the first prompt', async ($, on) => {
    const w = world(on)
    await start($)
    await turnStart($, 'first task')
    await turnEnd($)
    await turnStart($, 'continue')
    expect(selfEntry(w)?.title).toBe('first task')
  })

  test('a permission prompt is waiting-on-you until its call returns', async ($, on) => {
    const w = world(on)
    await start($)
    await turnStart($)
    w.check = { decision: 'ask' }
    w.holdMs = 60_000
    const pending = $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    await w.clock.settle()
    // Core decides inside the running call; the ask puts a dialog in front of the person.
    await decide($, w, 'rm -rf build')
    expect(selfEntry(w)).toMatchObject({ state: 'waiting-on-you', waitingFor: 'permission', lastTool: 'Bash' })
    expect(w.statuses.at(-1)).toBe('PARTY 1 ▸ 1 WAITING')
    await w.clock.advance(60_000)
    await pending
    expect(selfEntry(w)).toMatchObject({ state: 'working', waitingFor: null })
  })

  test('an allowed call never shows as waiting', async ($, on) => {
    const w = world(on)
    await start($)
    await turnStart($)
    w.holdMs = 1_000
    const pending = $.tool.call({ tool: 'Bash', command: 'ls' })
    await w.clock.settle()
    await decide($, w, 'ls')
    await w.clock.advance(1_000)
    await pending
    expect(w.statuses.some(line => line?.includes('1 WAITING'))).toBe(false)
  })

  test('a query from outside any call is not a wait', async ($, on) => {
    const w = world(on)
    await start($)
    w.check = { decision: 'ask' }
    await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })
    expect(selfEntry(w)?.state).toBe('idle')
  })

  test('AskUserQuestion and ExitPlanMode wait on you while they are open', async ($, on) => {
    const w = world(on)
    await start($)
    await turnStart($)
    w.holdMs = 30_000
    for (const [tool, kind] of [['AskUserQuestion', 'question'], ['ExitPlanMode', 'plan']] as const) {
      const pending = $.tool.call({ tool, questions: [] } as never)
      await w.clock.settle()
      expect(selfEntry(w)).toMatchObject({ state: 'waiting-on-you', waitingFor: kind })
      await w.clock.advance(30_000)
      await pending
      expect(selfEntry(w)?.state).toBe('working')
    }
  })

  test('a parallel call that returns first leaves an open permission prompt waiting', async ($, on) => {
    const w = world(on)
    await start($)
    await turnStart($)
    w.check = { decision: 'ask' }
    w.holdBy = { 'curl https://api.example.com': 60_000, 'grep -r todo': 1_000 }
    const asked = $.tool.call({ tool: 'Bash', command: 'curl https://api.example.com' })
    const quick = $.tool.call({ tool: 'Bash', command: 'grep -r todo' })
    await w.clock.settle()
    await decide($, w, 'curl https://api.example.com')
    expect(selfEntry(w)).toMatchObject({ state: 'waiting-on-you', waitingFor: 'permission' })
    await w.clock.advance(1_000)
    await quick
    expect(selfEntry(w)).toMatchObject({ state: 'waiting-on-you', waitingFor: 'permission', since: NOW })
    await w.clock.advance(59_000)
    await asked
    expect(selfEntry(w)).toMatchObject({ state: 'working', waitingFor: null })
  })

  test('an open question stays waiting while a parallel call returns', async ($, on) => {
    const w = world(on)
    await start($)
    await turnStart($)
    w.holdBy = { AskUserQuestion: 60_000, ls: 1_000 }
    const question = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
    const quick = $.tool.call({ tool: 'Bash', command: 'ls' })
    await w.clock.advance(1_000)
    await quick
    expect(selfEntry(w)).toMatchObject({ state: 'waiting-on-you', waitingFor: 'question' })
    await w.clock.advance(59_000)
    await question
    expect(selfEntry(w)?.state).toBe('working')
  })

  test('a wait raised after the turn ended goes back to idle, not working', async ($, on) => {
    const w = world(on)
    await start($)
    await turnStart($)
    await turnEnd($)
    // A background subagent's call asks after the main turn is over.
    w.check = { decision: 'ask' }
    w.holdMs = 30_000
    const pending = $.tool.call({ tool: 'Bash', command: 'npm publish', agentId: 'bg-agent' } as never)
    await w.clock.settle()
    await decide($, w, 'npm publish')
    expect(selfEntry(w)).toMatchObject({ state: 'waiting-on-you', waitingFor: 'permission' })
    await w.clock.advance(30_000)
    await pending
    expect(selfEntry(w)).toMatchObject({ state: 'idle', waitingFor: null })
  })

  test('session end writes done and stops beating', async ($, on) => {
    const w = world(on)
    await start($)
    await $.session.end({ reason: 'prompt_input_exit', sessionId: SELF, resume: { id: SELF } } as never)
    expect(selfEntry(w)?.state).toBe('done')
    const beat = selfEntry(w)?.beatAt
    await w.clock.advance(60_000)
    expect(selfEntry(w)?.beatAt).toBe(beat)
  })
})

describe('/clear', () => {
  test('the old conversation is done and the new one keeps beating as a fresh member', async ($, on) => {
    const w = world(on)
    await start($)
    await turnStart($, 'old task')
    await $.session.end({ reason: 'clear', sessionId: SELF, resume: { id: SELF } } as never)
    expect(selfEntry(w)?.state).toBe('done')
    w.sessionId = 'after-clear'
    await w.clock.advance(15_000)
    expect(w.store['session:after-clear']).toMatchObject({ state: 'idle', title: '', cwd: '/work/app', beatAt: NOW + 15_000 })
  })
})

describe('/resume', () => {
  test('the old conversation is done and the resumed one keeps beating as a fresh member', async ($, on) => {
    const w = world(on)
    await start($)
    await turnStart($, 'old task')
    await $.session.end({ reason: 'resume', sessionId: SELF, resume: { id: SELF } } as never)
    expect(selfEntry(w)?.state).toBe('done')
    w.sessionId = 'resumed'
    await w.clock.advance(3 * 60_000)
    expect(w.store['session:resumed']).toMatchObject({ state: 'idle', title: '', cwd: '/work/app', beatAt: NOW + 3 * 60_000 })
    expect(w.statuses.at(-1)).toBe('PARTY 1 ▸ 0 WAITING')
    await turnStart($, 'new task')
    expect(w.store['session:resumed']).toMatchObject({ state: 'working', title: 'new task' })
  })
})

describe('nag', () => {
  test('toasts once when another session has waited longer than nagMinutes', async ($, on) => {
    const w = world(on, { 'session:b': other({ sessionId: 'b', state: 'waiting-on-you', waitingFor: 'question', since: NOW }) })
    await start($)
    expect(w.toasts).toEqual([])
    // Keep the other session fresh while time passes.
    for (let beat = 0; beat < 22; beat += 1) {
      ;(w.store['session:b'] as { beatAt: number }).beatAt = w.clock.now()
      await w.clock.advance(15_000)
    }
    expect(w.toasts.filter(text => text.includes('WAITING'))).toEqual(['PARTY ▸ ship the release WAITING ON YOU 5M'])
  })

  test('this session waiting never nags itself', async ($, on) => {
    const w = world(on)
    await start($)
    await turnStart($)
    w.holdMs = 10 * 60_000
    const pending = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
    await w.clock.advance(10 * 60_000)
    await pending
    expect(w.toasts).toEqual([])
  })
})

describe('PR locks', () => {
  test('another live session touched the PR recently: the call becomes an ask naming it', async ($, on) => {
    const w = world(on, {
      'session:b': other({ sessionId: 'b', touches: [{ repo: 'example/app', pr: 42, at: NOW - 3 * 60_000 }] }),
    })
    await start($)
    const checked = await $.tool.check({ tool: 'Bash', input: { command: 'gh pr merge 42 --squash' } })
    expect(checked.decision).toBe('ask')
    expect(checked.reason).toContain('ship the release')
    expect(checked.reason).toContain('example/app#42')
    const url = await $.tool.check({ tool: 'Bash', input: { command: 'gh pr comment https://github.com/example/app/pull/42 -b hi' } })
    expect(url.decision).toBe('ask')
  })

  test('no lock for the same session', async ($, on) => {
    const w = world(on)
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'gh pr comment 42 --body hi' })
    expect(selfEntry(w)?.touches).toEqual([{ repo: 'example/app', pr: 42, at: NOW }])
    const checked = await $.tool.check({ tool: 'Bash', input: { command: 'gh pr merge 42' } })
    expect(checked.decision).toBe('allow')
  })

  test('no lock once the window passed, for a stale session, or for another PR', async ($, on) => {
    const w = world(on, {
      'session:old': other({ sessionId: 'old', touches: [{ repo: 'example/app', pr: 42, at: NOW - 11 * 60_000 }] }),
      'session:gone': other({ sessionId: 'gone', beatAt: NOW - STALE - 1, touches: [{ repo: 'example/app', pr: 42, at: NOW }] }),
      'session:near': other({ sessionId: 'near', touches: [{ repo: 'example/app', pr: 41, at: NOW }] }),
    })
    await start($)
    const checked = await $.tool.check({ tool: 'Bash', input: { command: 'gh pr merge 42' } })
    expect(checked.decision).toBe('allow')
    expect(w.ran).toEqual([])
  })

  test('lockMinutes is read from userConfig', { options: { lockMinutes: 2 } }, async ($, on) => {
    world(on, { 'session:b': other({ sessionId: 'b', touches: [{ repo: 'example/app', pr: 42, at: NOW - 3 * 60_000 }] }) })
    await start($)
    const checked = await $.tool.check({ tool: 'Bash', input: { command: 'gh pr merge 42' } })
    expect(checked.decision).toBe('allow')
  })

  test('a deny from below stays a deny', async ($, on) => {
    const w = world(on, { 'session:b': other({ sessionId: 'b', touches: [{ repo: 'example/app', pr: 42, at: NOW }] }) })
    w.check = { decision: 'deny', reason: 'settings deny' }
    await start($)
    const checked = await $.tool.check({ tool: 'Bash', input: { command: 'gh pr merge 42' } })
    expect(checked).toEqual({ decision: 'deny', reason: 'settings deny' })
  })

  test('a denied call records no touch', async ($, on) => {
    const w = world(on)
    w.deny = 'the person said no'
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'gh pr merge 42' })
    expect(selfEntry(w)?.touches).toEqual([])
  })
})

describe('/broadcast', () => {
  test('sends to every other live session and skips self', async ($, on) => {
    const w = world(on, {
      'session:b': other({ sessionId: 'b' }),
      'session:c': other({ sessionId: 'c', state: 'idle' }),
      'session:gone': other({ sessionId: 'gone', beatAt: NOW - STALE - 1 }),
    })
    await start($)
    const reply = await $.command.run({ command: 'broadcast', args: 'rebase on main before you push' } as never)
    expect(w.sent.map(one => one.text)).toEqual(['rebase on main before you push', 'rebase on main before you push'])
    expect(w.sent.some(one => one.to.includes(SELF))).toBe(false)
    expect(w.sent.some(one => one.to.includes('gone'))).toBe(false)
    expect(reply.text).toContain('2/2')
    expect(w.copied).toEqual([])
  })

  test('an undelivered send is reported and the text goes to the clipboard', async ($, on) => {
    const w = world(on, { 'session:b': other({ sessionId: 'b' }), 'session:c': other({ sessionId: 'c' }) })
    w.unreachable.add('c')
    await start($)
    const reply = await $.command.run({ command: 'broadcast', args: 'stop pushing' } as never)
    expect(reply.text).toContain('1/2')
    expect(reply.text).toContain('clipboard')
    expect(w.copied).toEqual(['stop pushing'])
  })

  test('alone, or with no text, nothing is sent', async ($, on) => {
    const w = world(on)
    await start($)
    expect((await $.command.run({ command: 'broadcast', args: 'hello' } as never)).text).toContain('nobody')
    expect((await $.command.run({ command: 'broadcast', args: '  ' } as never)).text).toContain('Usage')
    expect(w.sent).toEqual([])
  })
})

describe('/party', () => {
  test('opens the pane and replies with the roster', async ($, on) => {
    const w = world(on, { 'session:b': other({ sessionId: 'b', state: 'waiting-on-you', waitingFor: 'permission', since: NOW - 6 * 60_000 }) })
    await start($)
    const reply = await $.command.run({ command: 'party' } as never)
    expect(w.opened).toEqual(['party'])
    expect(reply.text).toContain('PARTY 2 ▸ 1 WAITING')
    expect(reply.text).toContain('2P ship the release · app-two@feat/release · WAITING ON YOU · PERMISSION 6M')
    expect(reply.text).toContain('1UP app · app@feat/login · IDLE')
  })
})
