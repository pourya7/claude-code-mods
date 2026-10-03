import { describe, expect, test } from 'claude-code/testing'

import { BUGGY, FIXED, LOCK, ROOT, makeRepo } from './repo'
import { GATE, NO_GATE, START, gate, prove, world } from './world'

describe('/prove', () => {
  test('registers /prove; with the gate off the status line stays quiet until a run', NO_GATE, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.commands).toEqual(['prove'])
    expect(w.statuses.filter(Boolean)).toEqual([])
  })

  test('PROVEN: replies with the verdict, tells the model, exits 0 and sets the status', NO_GATE, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const reply = await $.command.run(prove())
    expect(reply.text).toContain('PROVE-IT ▸ PROVEN ★')
    expect(reply.text).toContain('without the fix: FAIL')
    expect(reply.context?.[0]).toContain('PROVEN ★')
    expect(reply.exitCode).toBe(0)
    expect(w.statuses).toContain('PROVE-IT ▸ PROVING 1/2')
    expect(w.statuses).toContain('PROVE-IT ▸ PROVING 2/2')
    expect(w.statuses.at(-1)).toBe('PROVE-IT ★ PROVEN')
    expect(w.repo.files.get(`${ROOT}/src/add.ts`)).toBe(FIXED)
    expect(w.cwds.every(cwd => cwd === undefined || cwd === ROOT)).toBe(true)
  })

  test('NOT PROVEN exits 1 and says the tests do not test the fix', NO_GATE, async ($, on) => {
    world(on, makeRepo({ judge: () => 0 }))
    await $.session.start(START)
    const reply = await $.command.run(prove())
    expect(reply.text).toContain('NOT PROVEN')
    expect(reply.text).toContain('do not test it')
    expect(reply.exitCode).toBe(1)
  })

  test('BROKEN is reported', NO_GATE, async ($, on) => {
    world(on, makeRepo({ judge: () => 1 }))
    await $.session.start(START)
    expect((await $.command.run(prove())).text).toContain('BROKEN')
  })

  test('no test changed is reported', NO_GATE, async ($, on) => {
    const repo = makeRepo()
    repo.files.delete(`${ROOT}/src/add.test.ts`)
    world(on, repo)
    await $.session.start(START)
    const reply = await $.command.run(prove())
    expect(reply.text).toContain('NO TESTS CHANGED')
    expect(repo.testRuns).toBe(0)
  })

  test('an error in the test command restores the tree and says so', NO_GATE, async ($, on) => {
    const w = world(on, makeRepo({ failToStartOnRun: 1 }))
    await $.session.start(START)
    const reply = await $.command.run(prove())
    expect(reply.text).toContain('ERROR')
    expect(reply.text).toContain('spawn npm ENOENT')
    expect(w.repo.files.get(`${ROOT}/src/add.ts`)).toBe(FIXED)
  })

  test('a failed restore toasts and names the copies', NO_GATE, async ($, on) => {
    const w = world(on, makeRepo({ corruptRestore: 'garbage' }))
    await $.session.start(START)
    const reply = await $.command.run(prove())
    expect(reply.text).toContain('RESTORE FAILED')
    expect(reply.text).toContain('/tmp/t/prove-it-1000')
    expect(w.toasts.some(toast => toast.includes('RESTORE FAILED'))).toBe(true)
  })

  test('with no test command set, /prove says how to set it', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(prove())).text).toContain('testCommand')
  })

  test('/prove status shows the last proof without running anything', NO_GATE, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect((await $.command.run(prove('status'))).text).toContain('no proof yet')
    await $.command.run(prove())
    const runs = w.repo.testRuns
    expect((await $.command.run(prove('status'))).text).toContain('PROVEN ★')
    expect(w.repo.testRuns).toBe(runs)
  })

  test('an unknown word shows the usage', NO_GATE, async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(prove('frobnicate'))).text).toContain('Usage: /prove')
  })
})

describe('the gate', () => {
  test('off by default: git push runs without a proof', NO_GATE, async ($, on) => {
    const w = world(on, makeRepo({ judge: () => 0 }))
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'git push -u origin feat/x' })
    expect(w.bash).toEqual(['git push -u origin feat/x'])
    expect(w.repo.testRuns).toBe(0)
  })

  test('on: a proven change pushes', GATE, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.statuses.at(-1)).toBe('PROVE-IT ▸ GATE ARMED')
    const ran = await $.tool.call({ tool: 'Bash', command: 'git push -u origin feat/x' })
    expect(ran.deny).toBeUndefined()
    expect(w.bash).toEqual(['git push -u origin feat/x'])
    expect(w.repo.testRuns).toBe(2)
  })

  test('on: NOT PROVEN denies git push with the reason', GATE, async ($, on) => {
    const w = world(on, makeRepo({ judge: () => 0 }))
    await $.session.start(START)
    const ran = await $.tool.call({ tool: 'Bash', command: 'git push' })
    expect(ran.deny).toContain('NOT PROVEN')
    expect(ran.deny).toContain('/prove skip')
    expect(w.bash).toEqual([])
    expect(w.toasts.some(toast => toast.includes('NOT PROVEN'))).toBe(true)
  })

  test('on: BROKEN denies gh pr create, subagents included', GATE, async ($, on) => {
    const w = world(on, makeRepo({ judge: () => 1 }))
    await $.session.start(START)
    const ran = await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill', agentId: 'sub-1' } as never)
    expect(ran.deny).toContain('BROKEN')
    expect(w.bash).toEqual([])
  })

  test('on: no test changed denies', GATE, async ($, on) => {
    const repo = makeRepo()
    repo.files.delete(`${ROOT}/src/add.test.ts`)
    world(on, repo)
    await $.session.start(START)
    expect((await $.tool.call({ tool: 'Bash', command: 'git push' })).deny).toContain('NO TESTS CHANGED')
  })

  test('/prove skip lets exactly the next push or PR through', GATE, async ($, on) => {
    const w = world(on, makeRepo({ judge: () => 0 }))
    await $.session.start(START)
    const reply = await $.command.run(prove('skip'))
    expect(reply.text).toMatch(/next push or PR/i)
    const first = await $.tool.call({ tool: 'Bash', command: 'git push' })
    expect(first.deny).toBeUndefined()
    expect(w.repo.testRuns).toBe(0)
    const second = await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
    expect(second.deny).toContain('NOT PROVEN')
    expect(w.bash).toEqual(['git push'])
  })

  test('other commands pass untouched', GATE, async ($, on) => {
    const w = world(on, makeRepo({ judge: () => 0 }))
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    await $.tool.call({ tool: 'Bash', command: 'gh pr view 42' })
    expect(w.bash).toEqual(['git status', 'gh pr view 42'])
    expect(w.repo.testRuns).toBe(0)
  })

  test('an unchanged, already proven change is not proven again', GATE, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'git push' })
    await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
    expect(w.repo.testRuns).toBe(2)
    expect(w.bash).toEqual(['git push', 'gh pr create --fill'])

    w.repo.files.set(`${ROOT}/src/add.ts`, `${FIXED}// tweak\n`)
    w.repo.judge = files => ((files.get(`${ROOT}/src/add.ts`) ?? '').startsWith(FIXED) ? 0 : 1)
    await $.tool.call({ tool: 'Bash', command: 'git push' })
    expect(w.repo.testRuns).toBe(4)
  })

  test('the restore is verified even when the gate run errors, and the push is denied', GATE, async ($, on) => {
    const w = world(on, makeRepo({ failToStartOnRun: 1 }))
    await $.session.start(START)
    const ran = await $.tool.call({ tool: 'Bash', command: 'git push' })
    expect(ran.deny).toContain('ERROR')
    expect(w.repo.files.get(`${ROOT}/src/add.ts`)).toBe(FIXED)
    expect(w.bash).toEqual([])
  })
})

/** A hook above prove-it that gives up on the push after 100 ms, as an interrupt does: the dispatch goes on without prove-it. */
const INTERRUPTER = {
  name: 'interrupter',
  tier: 'prepend' as const,
  register: ((on: Parameters<import('claude-code').Register>[0]) => {
    on('tool.call', async ($, e, next) => {
      void next(e).catch(() => undefined)
      await $.clock.sleep(100)
      return { deny: 'interrupted' }
    })
  }) as import('claude-code').Register,
}

describe('interrupts and overlapping proofs', () => {
  test('an interrupt during a gated push restores the files at once, not when the tests end', { ...GATE, plugins: [INTERRUPTER] }, async ($, on) => {
    const w = world(on)
    const tests = gate()
    w.hold = tests.promise
    await $.session.start(START)
    const call = $.tool.call({ tool: 'Bash', command: 'git push' })
    await w.clock.settle()
    expect(w.repo.files.get(`${ROOT}/src/add.ts`)).toBe(BUGGY)

    await w.clock.advance(100)
    await call
    await w.clock.settle()
    expect(w.repo.files.get(`${ROOT}/src/add.ts`)).toBe(FIXED)
    expect(w.repo.dirs.has(LOCK)).toBe(false)
    expect(w.toasts.some(toast => toast.includes('INTERRUPTED'))).toBe(true)
    expect(w.bash).toEqual([])
    expect(w.statuses.at(-1)).toBe('PROVE-IT ▸ ERROR · GATE')
    tests.open()
  })

  test('a run releases only its own claim: an earlier run ending never frees a later one', NO_GATE, async ($, on) => {
    const w = world(on)
    const first = gate()
    const second = gate()
    await $.session.start(START)
    w.holdFor = argv => (argv[0] === 'npm' ? first.promise : undefined)
    const one = $.command.run(prove())
    await w.clock.settle()

    // The module reloads mid-run and a new run starts and is still surveying.
    await $.session.start(START)
    w.holdFor = argv =>
      argv[0] === 'npm' ? first.promise : argv.join(' ') === 'git rev-parse --show-toplevel' ? second.promise : undefined
    const two = $.command.run(prove())
    await w.clock.settle()

    first.open()
    await one
    await w.clock.settle()

    let third = ''
    void $.command.run(prove()).then(reply => {
      third = reply.text ?? ''
    })
    await w.clock.settle()
    expect(third).toContain('already running')

    second.open()
    await two
  })
})
