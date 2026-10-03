import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { register } from '../hooks/register'
import { FAIL_HIGH, FAIL_MEDIUM, PASS, PASS_WITH_LOW, SMALL_DIFF, START, coop, world } from './world'

const create = ($: Engine, command = 'gh pr create --fill', agentId?: string) =>
  $.tool.call({ tool: 'Bash', command, ...(agentId ? { agentId } : {}) } as never)

const diffCalls = (w: ReturnType<typeof world>) => w.processCalls.filter(call => call.argv[0] === 'git' && call.argv[1] === 'diff')

describe('the gate on gh pr create', () => {
  test('a pass lets the PR through', async ($, on) => {
    const w = world(on, { answers: [{ text: PASS }] })
    await $.session.start(START)
    const ran = await create($)
    expect(ran.deny).toBeUndefined()
    expect(w.bash.map(call => call.command)).toEqual(['gh pr create --fill'])
    expect(w.modelCalls).toHaveLength(1)
    expect(w.modelCalls[0]?.prompt).toContain('+  await charge(id)')
    expect(w.statuses.slice(-2)).toEqual(['CO-OP ▸ REVIEWING', 'CO-OP ▸ PASS'])
    expect(w.toasts.at(-1)).toContain('PASS')
  })

  test('a pass with findings attaches them as context the model reads', async ($, on) => {
    world(on, { answers: [{ text: PASS_WITH_LOW }] })
    await $.session.start(START)
    const ran = await create($)
    expect(ran.deny).toBeUndefined()
    expect(ran.context?.join('\n')).toContain('LOW  src/pay.ts:41 Name the retry count.')
  })

  test('a fail with a high finding denies the create, with the findings', async ($, on) => {
    const w = world(on, { answers: [{ text: FAIL_HIGH }] })
    await $.session.start(START)
    const ran = await create($)
    expect(ran.deny).toContain('BLOCKED')
    expect(ran.deny).toContain('HIGH src/pay.ts:41 Refund charges the customer instead.')
    expect(ran.deny).toContain('LOW  src/pay.ts No log line.')
    expect(w.bash).toHaveLength(0)
    expect(w.statuses.at(-1)).toBe('CO-OP ▸ FAIL 1H 1L')
    expect(w.toasts.at(-1)).toContain('BLOCKED')
  })

  test('a fail with no high finding lets it through and says why', async ($, on) => {
    const w = world(on, { answers: [{ text: FAIL_MEDIUM }] })
    await $.session.start(START)
    const ran = await create($)
    expect(ran.deny).toBeUndefined()
    expect(w.bash).toHaveLength(1)
    expect(ran.context?.join('\n')).toContain('not blocking')
    expect(ran.context?.join('\n')).toContain('MED  src/pay.ts:41 Retry is not idempotent.')
    expect(w.statuses.at(-1)).toBe('CO-OP ▸ FLAGGED 1M')
  })

  test('subagent calls are gated too', async ($, on) => {
    const w = world(on, { answers: [{ text: FAIL_HIGH }] })
    await $.session.start(START)
    const ran = await create($, 'gh pr create --fill', 'agent-7')
    expect(ran.deny).toContain('BLOCKED')
    expect(w.bash).toHaveLength(0)
  })

  test('other commands run untouched and cost nothing', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    for (const command of ['gh pr view 42', 'git push -u origin HEAD', 'echo "gh pr create later"']) {
      const ran = await create($, command)
      expect(ran.deny).toBeUndefined()
    }
    expect(w.bash).toHaveLength(3)
    expect(w.modelCalls).toHaveLength(0)
    expect(w.processCalls).toHaveLength(0)
  })

  test('a commit message that mentions gh pr create runs untouched', async ($, on) => {
    const w = world(on, { answers: [{ text: FAIL_HIGH }] })
    await $.session.start(START)
    const command = 'git commit -m "fix: refund; then gh pr create later"'
    const ran = await create($, command)
    expect(ran.deny).toBeUndefined()
    expect(w.bash.map(call => call.command)).toEqual([command])
    expect(w.modelCalls).toHaveLength(0)
    expect(w.processCalls).toHaveLength(0)
  })

  test("gh's own alias gh pr new and gh by its full path are gated too", async ($, on) => {
    const w = world(on, { answers: [{ text: FAIL_HIGH }, { text: FAIL_HIGH }] })
    await $.session.start(START)
    expect((await create($, 'gh pr new --fill')).deny).toContain('BLOCKED')
    expect((await create($, '/opt/homebrew/bin/gh pr create --fill')).deny).toContain('BLOCKED')
    expect(w.bash).toHaveLength(0)
  })
})

describe('an interrupted create', () => {
  type Handler = (...args: unknown[]) => Promise<unknown>
  /** co-op's own hooks, to call with a `$` and a dispatch signal the test controls. */
  const hooksOf = (): Record<string, Handler> => {
    const hooks: Record<string, Handler> = {}
    register(((event: string, ...rest: unknown[]) => {
      hooks[event] = rest.at(-1) as Handler
    }) as never, {})
    return hooks
  }

  /** A plain `$`: git answers SMALL_DIFF, and the model call is where the person presses escape. */
  const fakeDollar = (stop: AbortController) => {
    const state = new Map<string, unknown>()
    const seen = { toasts: [] as string[], statuses: [] as (string | undefined)[], signals: [] as unknown[] }
    const dollar = {
      state: {
        get: async (ref: { key: string }) => ({ value: state.get(ref.key), version: 0 }),
        set: async (ref: { key: string }, value: unknown) => {
          state.set(ref.key, value)
          return { isWritten: true, version: 1 }
        },
      },
      ui: {
        toast: (text: string) => seen.toasts.push(text),
        status: (text?: string) => seen.statuses.push(text),
        open: async () => ({ isPlaced: false }),
      },
      process: {
        run: async (argv: string[]) => {
          if (argv[1] === 'symbolic-ref') return { exitCode: 0, stdout: 'origin/main\n', stderr: '' }
          if (argv[1] === 'diff') return { exitCode: 0, stdout: SMALL_DIFF, stderr: '' }
          return { exitCode: 0, stdout: '', stderr: '' }
        },
      },
      model: {
        complete: async (_request: unknown, options?: { signal?: AbortSignal }) => {
          seen.signals.push(options?.signal)
          stop.abort()
          return { isAnswered: false, reason: 'aborted', usage: {} }
        },
      },
      session: { model: async () => 'claude-opus-5-5' },
      clock: { now: async () => 0 },
      env: { get: async () => undefined },
    }
    return { dollar, state, seen }
  }

  test('passes the signal on, records and announces nothing, and never runs gh', async () => {
    const stop = new AbortController()
    const { dollar, state, seen } = fakeDollar(stop)
    let ranNext = false
    const next = Object.assign(
      async () => {
        ranNext = true
        return {}
      },
      { signal: stop.signal },
    )
    const ran = (await hooksOf()['tool.call']?.(dollar, { tool: 'Bash', command: 'gh pr create --fill' }, next)) as {
      deny?: string
    }
    expect(seen.signals).toEqual([stop.signal])
    expect(ranNext).toBe(false)
    expect(ran.deny).toContain('cancelled')
    expect(seen.toasts).toEqual([])
    expect(state.get('last')).toBeUndefined()
    expect(state.get('isReviewing')).toBe(false)
    expect(seen.statuses.at(-1)).toBe('CO-OP ▸ READY')
  })

  test('an interrupted /coop says so and records nothing', async () => {
    const stop = new AbortController()
    const { dollar, state, seen } = fakeDollar(stop)
    const next = Object.assign(async () => ({}), { signal: stop.signal })
    const ran = (await hooksOf()['command.run']?.(dollar, coop(), next)) as { text?: string }
    expect(ran.text).toContain('cancelled')
    expect(seen.toasts).toEqual([])
    expect(state.get('last')).toBeUndefined()
  })
})

describe('failing open', () => {
  test('unparsable reviewer output lets the PR through with a toast', async ($, on) => {
    const w = world(on, { answers: [{ text: 'Looks fine to me, ship it!' }] })
    await $.session.start(START)
    const ran = await create($)
    expect(ran.deny).toBeUndefined()
    expect(w.bash).toHaveLength(1)
    expect(w.toasts.at(-1)).toContain('UNREADABLE')
    expect(ran.context?.join('\n')).toContain('no JSON object in the reply')
    expect(w.statuses.at(-1)).toBe('CO-OP ▸ NO REVIEW')
  })

  test('a model API error lets the PR through', async ($, on) => {
    const w = world(on, { answers: [{ error: 'overloaded_error' }] })
    await $.session.start(START)
    const ran = await create($)
    expect(ran.deny).toBeUndefined()
    expect(w.bash).toHaveLength(1)
    expect(w.toasts.at(-1)).toContain('UNREADABLE')
  })

  test('a refused model call lets the PR through', async ($, on) => {
    const w = world(on, { answers: [{ throws: 'model is not allowed' }] })
    await $.session.start(START)
    const ran = await create($)
    expect(ran.deny).toBeUndefined()
    expect(w.bash).toHaveLength(1)
  })

  test('a failing git diff lets the PR through', async ($, on) => {
    const w = world(on, { diffError: 'fatal: bad revision' })
    await $.session.start(START)
    const ran = await create($)
    expect(ran.deny).toBeUndefined()
    expect(w.bash).toHaveLength(1)
    expect(w.modelCalls).toHaveLength(0)
    expect(ran.context?.join('\n')).toContain('fatal: bad revision')
  })

  test('the same unreadable review is never cached: the next create asks again', async ($, on) => {
    const w = world(on, { answers: [{ text: 'garbage' }, { text: FAIL_HIGH }] })
    await $.session.start(START)
    await create($)
    const second = await create($)
    expect(w.modelCalls).toHaveLength(2)
    expect(second.deny).toContain('BLOCKED')
  })
})

describe('/coop skip', () => {
  test('lets exactly the next create through unreviewed', async ($, on) => {
    const w = world(on, { answers: [{ text: FAIL_HIGH }] })
    await $.session.start(START)
    const reply = await $.command.run(coop('skip'))
    expect(reply.text).toContain('next gh pr create')
    expect(w.statuses.at(-1)).toBe('CO-OP ▸ SKIP NEXT')

    const skipped = await create($)
    expect(skipped.deny).toBeUndefined()
    expect(w.modelCalls).toHaveLength(0)
    expect(skipped.context?.join('\n')).toContain('/coop skip')
    expect(w.statuses.at(-1)).toBe('CO-OP ▸ SKIPPED')

    const reviewed = await create($)
    expect(reviewed.deny).toContain('BLOCKED')
    expect(w.modelCalls).toHaveLength(1)
  })

  test('/coop unskip disarms it', async ($, on) => {
    const w = world(on, { answers: [{ text: FAIL_HIGH }] })
    await $.session.start(START)
    await $.command.run(coop('skip'))
    await $.command.run(coop('unskip'))
    const ran = await create($)
    expect(ran.deny).toContain('BLOCKED')
    expect(w.modelCalls).toHaveLength(1)
  })
})

describe('re-review after fixes', () => {
  test('a changed diff is reviewed again; the same diff reuses the verdict', async ($, on) => {
    const w = world(on, { answers: [{ text: FAIL_HIGH }, { text: PASS }] })
    await $.session.start(START)
    expect((await create($)).deny).toContain('BLOCKED')
    expect((await create($)).deny).toContain('BLOCKED')
    expect(w.modelCalls).toHaveLength(1)

    w.diff = SMALL_DIFF.replace('await charge(id)', 'await refundCharge(id)')
    const fixed = await create($)
    expect(fixed.deny).toBeUndefined()
    expect(w.modelCalls).toHaveLength(2)
    expect(w.bash).toHaveLength(1)
  })

  test('a change past the maxDiffKb cut is reviewed again', { options: { maxDiffKb: 1 } }, async ($, on) => {
    const big = `diff --git a/x b/x\n${`+${'a'.repeat(99)}\n`.repeat(40)}`
    const w = world(on, { diff: big, answers: [{ text: FAIL_HIGH }, { text: PASS }] })
    await $.session.start(START)
    expect((await create($)).deny).toContain('BLOCKED')
    w.diff = `${big}diff --git a/y b/y\n+the fix\n`
    const fixed = await create($)
    expect(w.modelCalls).toHaveLength(2)
    expect(fixed.deny).toBeUndefined()
  })
})

describe('the diff', () => {
  test('is taken against the --base branch, where a leading cd points', async ($, on) => {
    const w = world(on, { refs: ['origin/develop', 'origin/main'] })
    await $.session.start(START)
    await create($, "cd '/work/my app' && gh pr create --base develop --fill")
    const diff = diffCalls(w)[0]
    expect(diff?.argv).toContain('origin/develop...HEAD')
    expect(diff?.cwd).toBe('/work/my app')
  })

  test('falls back to origin/HEAD, then the usual names', async ($, on) => {
    const w = world(on, { originHead: undefined, refs: ['main'] })
    await $.session.start(START)
    await create($)
    expect(diffCalls(w)[0]?.argv).toContain('main...HEAD')
    expect(w.modelCalls[0]?.prompt).toContain('against main')
  })

  test('no base at all fails open with the reason', async ($, on) => {
    const w = world(on, { originHead: undefined, refs: [] })
    await $.session.start(START)
    const ran = await create($)
    expect(ran.deny).toBeUndefined()
    expect(w.modelCalls).toHaveLength(0)
    expect(ran.context?.join('\n')).toContain('--base')
  })

  test('an empty diff is not sent for review', async ($, on) => {
    const w = world(on, { diff: '' })
    await $.session.start(START)
    const ran = await create($)
    expect(ran.deny).toBeUndefined()
    expect(w.modelCalls).toHaveLength(0)
    expect(w.statuses.at(-1)).toBe('CO-OP ▸ NO DIFF')
  })

  test('a diff over maxDiffKb is truncated and the truncation is noted', { options: { maxDiffKb: 1 } }, async ($, on) => {
    const big = `diff --git a/x b/x\n${`+${'a'.repeat(99)}\n`.repeat(40)}`
    const w = world(on, { diff: big, answers: [{ text: FAIL_HIGH }] })
    await $.session.start(START)
    const ran = await create($)
    const prompt = w.modelCalls[0]?.prompt ?? ''
    expect(prompt).toContain('TRUNCATED')
    expect(prompt.length).toBeLessThan(big.length)
    expect(ran.deny).toContain('truncated to the first 1 KB')
  })
})

describe('the reviewer', () => {
  test('defaults to another tier than the session model', async ($, on) => {
    const w = world(on, { sessionModel: 'claude-opus-5-5' })
    await $.session.start(START)
    await create($)
    expect(w.modelCalls[0]?.model).toBe('sonnet')
  })

  test('uses userConfig.model when set, with the time limit', { options: { model: 'haiku', timeoutSeconds: 60 } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await create($)
    expect(w.modelCalls[0]?.model).toBe('haiku')
    expect(w.modelCalls[0]?.timeoutMs).toBe(60_000)
  })

  test('userConfig.command runs instead of the model, the diff on stdin', { options: { command: "my-reviewer --json '-'" } }, async ($, on) => {
    const w = world(on, { commandOut: { exitCode: 0, stdout: `noise\n${FAIL_HIGH}\n`, stderr: '' } })
    await $.session.start(START)
    const ran = await create($)
    const call = w.processCalls.find(one => one.argv[0] === 'my-reviewer')
    expect(call?.argv).toEqual(['my-reviewer', '--json', '-'])
    expect(call?.stdin).toContain('+  await charge(id)')
    expect(w.modelCalls).toHaveLength(0)
    expect(ran.deny).toContain('BLOCKED')
    expect(ran.deny).toContain('command:my-reviewer')
  })

  test('a reviewer command that exits non-zero fails open', { options: { command: 'my-reviewer' } }, async ($, on) => {
    const w = world(on, { commandOut: { exitCode: 2, stdout: '', stderr: 'not logged in' } })
    await $.session.start(START)
    const ran = await create($)
    expect(ran.deny).toBeUndefined()
    expect(ran.context?.join('\n')).toContain('not logged in')
    expect(w.toasts.at(-1)).toContain('UNREADABLE')
  })
})

describe('/coop', () => {
  test('registers the command on session start and shows READY', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.commands).toContain('coop')
    expect(w.statuses.at(-1)).toBe('CO-OP ▸ READY')
  })

  test('reviews the branch now and replies with the verdict, gating nothing', async ($, on) => {
    const w = world(on, { answers: [{ text: FAIL_HIGH }] })
    await $.session.start(START)
    const reply = await $.command.run(coop())
    expect(reply.text).toContain('FAIL')
    expect(reply.text).toContain('HIGH src/pay.ts:41')
    expect(w.bash).toHaveLength(0)
    expect(w.opened).toContain('co-op')
  })

  test('/coop always asks the reviewer again, even for the same diff', async ($, on) => {
    const w = world(on, { answers: [{ text: FAIL_HIGH }, { text: PASS }] })
    await $.session.start(START)
    await create($)
    const reply = await $.command.run(coop())
    expect(w.modelCalls).toHaveLength(2)
    expect(reply.text).toContain('PASS')
    expect((await create($)).deny).toBeUndefined()
  })

  test('/coop view opens the pane; unknown words print the usage', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.command.run(coop('view'))
    expect(w.opened).toEqual(['co-op'])
    expect((await $.command.run(coop('frobnicate'))).text).toContain('usage')
  })
})
