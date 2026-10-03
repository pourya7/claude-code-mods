import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

type Run = { name: string; status: string; conclusion: string | null }
type FakePr = {
  state: string
  headRefOid: string
  reviewDecision: string | null
  isInMergeQueue: boolean
  mergedAt: string | null
  threads: boolean[]
  threadIds?: string[]
  runs: Record<string, Run[]>
}
type World = {
  repo: string
  prs: Record<number, FakePr>
  gh: 'ok' | 'missing' | 'unauthenticated' | 'hang' | 'checks-forbidden'
  calls: string[][]
  /** Moves the mock clock while a hanging gh runs, as a real timeout would. */
  hang?: (milliseconds: number) => Promise<void>
}
type Seen = { prompts: string[]; toasts: string[]; statuses: (string | undefined)[]; opened: string[]; bash: string[] }

const SHA = 'abc1234def5678'
const LINT_FAILED: Run = { name: 'lint', status: 'completed', conclusion: 'failure' }
const LINT_PASSED: Run = { name: 'lint', status: 'completed', conclusion: 'success' }
const UNIT_RUNNING: Run = { name: 'unit', status: 'in_progress', conclusion: null }

function fakePr(over: Partial<FakePr> = {}): FakePr {
  return {
    state: 'OPEN',
    headRefOid: SHA,
    reviewDecision: 'REVIEW_REQUIRED',
    isInMergeQueue: false,
    mergedAt: null,
    threads: [],
    runs: { [SHA]: [] },
    ...over,
  }
}

function newWorld(prs: Record<number, FakePr> = { 12: fakePr() }): World {
  return { repo: 'acme/app', prs, gh: 'ok', calls: [] }
}

function argValue(argv: readonly string[], prefix: string): string | undefined {
  return argv.find(one => one.startsWith(prefix))?.slice(prefix.length)
}

function answerGh(world: World, argv: readonly string[]) {
  world.calls.push([...argv])
  if (world.gh === 'missing') throw new Error('spawn gh ENOENT')
  if (world.gh === 'unauthenticated') {
    return { exitCode: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' }
  }
  if (argv[1] === 'repo') return { exitCode: 0, stdout: `${world.repo}\n`, stderr: '' }
  if (argv[2] === 'graphql') {
    const number = Number(argValue(argv, 'number='))
    const pr = world.prs[number]
    if (!pr) {
      return { exitCode: 1, stdout: '', stderr: `GraphQL: Could not resolve to a PullRequest with the number of ${number}.` }
    }
    const after = Number(argValue(argv, 'after=') ?? '0')
    const page = pr.threads.slice(after, after + 100)
    const hasNextPage = after + 100 < pr.threads.length
    const body = {
      data: {
        repository: {
          pullRequest: {
            number,
            title: `Fix the thing ${number}`,
            url: `https://github.com/${world.repo}/pull/${number}`,
            state: pr.state,
            headRefOid: pr.headRefOid,
            mergeStateStatus: 'CLEAN',
            reviewDecision: pr.reviewDecision,
            isInMergeQueue: pr.isInMergeQueue,
            mergedAt: pr.mergedAt,
            reviewThreads: {
              pageInfo: { hasNextPage, endCursor: hasNextPage ? String(after + 100) : null },
              nodes: page.map((isResolved, index) => ({ id: pr.threadIds?.[after + index] ?? `T${after + index}`, isResolved })),
            },
          },
        },
      },
    }
    return { exitCode: 0, stdout: JSON.stringify(body), stderr: '' }
  }
  const path = argv[2] ?? ''
  const match = /commits\/([^/]+)\/check-runs\?per_page=100&page=(\d+)/.exec(path)
  if (match && world.gh === 'checks-forbidden') {
    return { exitCode: 1, stdout: '', stderr: 'gh: Resource not accessible by personal access token (HTTP 403)' }
  }
  if (match) {
    const runs = Object.values(world.prs).find(pr => pr.runs[match[1] ?? ''])?.runs[match[1] ?? ''] ?? []
    const page = Number(match[2])
    const body = { total_count: runs.length, check_runs: runs.slice((page - 1) * 100, page * 100) }
    return { exitCode: 0, stdout: JSON.stringify(body), stderr: '' }
  }
  return { exitCode: 1, stdout: '', stderr: `unexpected gh call: ${argv.join(' ')}` }
}

function engineBelow(on: On, world: World): Seen {
  const seen: Seen = { prompts: [], toasts: [], statuses: [], opened: [], bash: [] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: e.name } }))
  on('process.run', async ($, e) => {
    if (world.gh === 'hang') {
      world.calls.push([...e.argv])
      // Answers late, then fails: the run rejects 30 s after it started, as a timeout does.
      await world.hang?.(30_000)
      throw new Error('gh hung')
    }
    return { value: answerGh(world, e.argv) }
  })
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    seen.opened.push(e.id)
    return { value: { isOpen: true } as never }
  })
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash') seen.bash.push(e.command)
    return { result: 'ran' }
  })
  return seen
}

async function start($: Engine) {
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
}

async function bash($: Engine, command: string) {
  return $.tool.call({ tool: 'Bash', command })
}

describe('watch list', () => {
  test('/watch <n> adds the PR scoped to the repo and replies with its truth', async ($, on) => {
    mock.clock(on)
    const world = newWorld()
    const seen = engineBelow(on, world)
    await start($)
    const reply = await $.command.run({ command: 'watch', args: '12' })
    expect(reply.text).toContain('PR #12')
    expect(reply.text).toContain('acme/app')
    expect(world.calls[0]).toEqual(['gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
    expect(seen.statuses.at(-1)).toBe('SENTRY #12 CI░ REV░ 0T')
  })

  test('/watch <PR URL> takes the repo from the URL', async ($, on) => {
    mock.clock(on)
    const world = newWorld()
    world.repo = 'other/thing'
    engineBelow(on, world)
    await start($)
    const reply = await $.command.run({ command: 'watch', args: 'https://github.com/other/thing/pull/12' })
    expect(reply.text).toContain('other/thing')
    expect(world.calls.some(argv => argv[1] === 'repo')).toBe(false)
  })

  test('/unwatch <n> removes it and clears the status line', async ($, on) => {
    mock.clock(on)
    const seen = engineBelow(on, newWorld())
    await start($)
    await $.command.run({ command: 'watch', args: '12' })
    const reply = await $.command.run({ command: 'unwatch', args: '#12' })
    expect(reply.text).toContain('PR #12')
    expect(seen.statuses.at(-1)).toBeUndefined()
    const again = await $.command.run({ command: 'unwatch', args: '12' })
    expect(again.text).toContain('not watching')
  })

  test('/watch with no argument opens the pane', async ($, on) => {
    mock.clock(on)
    const seen = engineBelow(on, newWorld())
    await start($)
    await $.command.run({ command: 'watch' })
    expect(seen.opened).toEqual(['sentry'])
  })

  test('a PR that does not exist is not added', async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    engineBelow(on, world)
    await start($)
    const reply = await $.command.run({ command: 'watch', args: '99' })
    expect(reply.text).toContain('Could not resolve')
    world.calls.length = 0
    await clock.advance(60_000)
    expect(world.calls).toEqual([])
  })
})

describe('the truth rules', () => {
  test('zero check-runs is pending, not green, even when approved with no threads', async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld({ 12: fakePr({ reviewDecision: 'APPROVED' }) })
    const seen = engineBelow(on, world)
    await start($)
    const reply = await $.command.run({ command: 'watch', args: '12' })
    expect(reply.text).toContain('CI PENDING')
    await clock.advance(60_000)
    expect(seen.prompts).toEqual([])
    const state = await $.tool.call({ tool: 'mcp__sentry__pr_state', pr: 12 })
    expect(JSON.stringify(state.result)).toContain('"ci":"pending"')
  })

  test('check-runs are read for the head SHA across pages of 100', async ($, on) => {
    const clock = mock.clock(on)
    const runs: Run[] = Array.from({ length: 150 }, (_, index) => ({ ...LINT_PASSED, name: `check-${index}` }))
    const world = newWorld({ 12: fakePr({ runs: { [SHA]: runs } }) })
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'watch', args: '12' })
    runs[120] = { ...LINT_FAILED, name: 'check-120' }
    await clock.advance(60_000)
    expect(world.calls.some(argv => argv[2]?.endsWith(`commits/${SHA}/check-runs?per_page=100&page=2`))).toBe(true)
    expect(seen.prompts).toEqual(['SENTRY: PR #12 CI FAILED on abc1234 — failed checks: "check-120". Investigate.'])
  })

  test('a head change resets CI to pending', async ($, on) => {
    const clock = mock.clock(on)
    const pr = fakePr({ reviewDecision: 'APPROVED', runs: { [SHA]: [LINT_PASSED] } })
    const world = newWorld({ 12: pr })
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'watch', args: '12' })
    pr.headRefOid = 'fff9999aaa'
    pr.runs['fff9999aaa'] = []
    await clock.advance(60_000)
    const state = await $.tool.call({ tool: 'mcp__sentry__pr_state', pr: 12 })
    expect(JSON.stringify(state.result)).toContain('"ci":"pending"')
    expect(seen.prompts).toEqual([])
    expect(seen.toasts.at(-1)).toContain('NEW HEAD')
    expect(seen.statuses.at(-1)).toBe('SENTRY #12 CI░ REV▓ 0T')
  })

  test('unresolved review threads are counted across pages', async ($, on) => {
    mock.clock(on)
    const threads = [...Array.from({ length: 130 }, () => true), false, false]
    engineBelow(on, newWorld({ 12: fakePr({ threads }) }))
    await start($)
    const reply = await $.command.run({ command: 'watch', args: '12' })
    expect(reply.text).toContain('2 OPEN THREADS')
  })
})

describe('waking the session', () => {
  test('exactly one wake per transition, never repeated for the same state', async ($, on) => {
    const clock = mock.clock(on)
    const pr = fakePr({ runs: { [SHA]: [LINT_PASSED, UNIT_RUNNING] } })
    const seen = engineBelow(on, newWorld({ 12: pr }))
    await start($)
    await $.command.run({ command: 'watch', args: '12' })
    pr.runs[SHA] = [LINT_FAILED, UNIT_RUNNING]
    await clock.advance(60_000)
    await clock.advance(60_000)
    await clock.advance(60_000)
    expect(seen.prompts).toEqual(['SENTRY: PR #12 CI FAILED on abc1234 — failed checks: "lint". Investigate.'])
    expect(seen.toasts).toEqual(['SENTRY #12 CI FAILED'])
  })

  test('ready, changes requested, a new thread and merged each wake once', async ($, on) => {
    const clock = mock.clock(on)
    const pr = fakePr({ runs: { [SHA]: [UNIT_RUNNING] } })
    const seen = engineBelow(on, newWorld({ 12: pr }))
    await start($)
    await $.command.run({ command: 'watch', args: '12' })

    pr.reviewDecision = 'CHANGES_REQUESTED'
    pr.threads = [false]
    await clock.advance(60_000)
    pr.reviewDecision = 'APPROVED'
    pr.threads = [true]
    pr.runs[SHA] = [LINT_PASSED]
    await clock.advance(60_000)
    pr.state = 'MERGED'
    pr.mergedAt = '2026-10-03T10:00:00Z'
    await clock.advance(60_000)
    await clock.advance(60_000)

    expect(seen.prompts).toEqual([
      'SENTRY: PR #12 CHANGES REQUESTED — address the review. 1 OPEN THREAD (+1 new) — address them.',
      'SENTRY: PR #12 READY on abc1234 — CI green, approved, no open threads.',
      'SENTRY: PR #12 MERGED. Watch ended.',
    ])
  })

  test('a thread resolved and another opened between polls still wakes once', async ($, on) => {
    const clock = mock.clock(on)
    const pr = fakePr({ threads: [false], threadIds: ['A'] })
    const seen = engineBelow(on, newWorld({ 12: pr }))
    await start($)
    await $.command.run({ command: 'watch', args: '12' })
    pr.threads = [true, false]
    pr.threadIds = ['A', 'B']
    await clock.advance(60_000)
    await clock.advance(60_000)
    expect(seen.prompts).toEqual(['SENTRY: PR #12 1 OPEN THREAD (+1 new) — address them.'])
    expect(seen.toasts).toEqual(['SENTRY #12 NEW THREAD / THREAD RESOLVED'])
  })

  test('a non-actionable change redraws and toasts without waking', async ($, on) => {
    const clock = mock.clock(on)
    const pr = fakePr()
    const seen = engineBelow(on, newWorld({ 12: pr }))
    await start($)
    await $.command.run({ command: 'watch', args: '12' })
    pr.runs[SHA] = [UNIT_RUNNING]
    await clock.advance(60_000)
    expect(seen.prompts).toEqual([])
    expect(seen.toasts).toEqual(['SENTRY #12 CI RUNNING'])
    expect(seen.statuses.at(-1)).toBe('SENTRY #12 CI▒ REV░ 0T')
  })

  test('wake: never toasts but never submits', { options: { wake: 'never' } }, async ($, on) => {
    const clock = mock.clock(on)
    const pr = fakePr()
    const seen = engineBelow(on, newWorld({ 12: pr }))
    await start($)
    await $.command.run({ command: 'watch', args: '12' })
    pr.runs[SHA] = [LINT_FAILED]
    await clock.advance(60_000)
    expect(seen.prompts).toEqual([])
    expect(seen.toasts).toEqual(['SENTRY #12 CI FAILED'])
  })

  test('the poll interval comes from userConfig', { options: { intervalSeconds: 120 } }, async ($, on) => {
    const clock = mock.clock(on)
    const pr = fakePr()
    const seen = engineBelow(on, newWorld({ 12: pr }))
    await start($)
    await $.command.run({ command: 'watch', args: '12' })
    pr.runs[SHA] = [LINT_FAILED]
    await clock.advance(60_000)
    expect(seen.prompts).toEqual([])
    await clock.advance(60_000)
    expect(seen.prompts).toHaveLength(1)
  })

  test('a merged PR is no longer polled', async ($, on) => {
    const clock = mock.clock(on)
    const pr = fakePr()
    const world = newWorld({ 12: pr })
    engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'watch', args: '12' })
    pr.state = 'MERGED'
    await clock.advance(60_000)
    world.calls.length = 0
    await clock.advance(60_000)
    expect(world.calls).toEqual([])
  })
})

describe('poll denial', () => {
  test('sleep-poll shapes are denied only while a PR is watched', async ($, on) => {
    mock.clock(on)
    const seen = engineBelow(on, newWorld())
    await start($)
    expect((await bash($, 'sleep 60')).deny).toBeUndefined()

    await $.command.run({ command: 'watch', args: '12' })
    for (const command of [
      'sleep 60',
      'sleep 30 && gh pr checks 12',
      'gh pr checks 12 --watch',
      'gh run watch 4242',
      'until gh pr checks 12; do sleep 5; done',
      'while true; do gh pr view 12; sleep 10; done',
    ]) {
      const ran = await bash($, command)
      expect(ran.deny).toBe('sentry is watching PR #12 and will wake you; end your turn instead.')
    }
    expect((await bash($, 'sleep 5')).deny).toBeUndefined()
    expect((await bash($, 'npm test')).deny).toBeUndefined()
    for (const command of [
      'git commit -m "fix crash while loading" && git push && gh pr create --fill',
      'git commit -m "retry: sleep 30 between attempts"',
      'while read f; do echo "$f"; done < list.txt; gh pr view 12',
    ]) {
      expect((await bash($, command)).deny).toBeUndefined()
    }

    await $.command.run({ command: 'unwatch', args: '12' })
    expect((await bash($, 'sleep 60')).deny).toBeUndefined()
    expect(seen.bash).toHaveLength(7)
    expect(seen.bash.at(-1)).toBe('sleep 60')
  })

  test('a merged PR no longer counts as watched', async ($, on) => {
    const clock = mock.clock(on)
    const pr = fakePr()
    engineBelow(on, newWorld({ 12: pr }))
    await start($)
    await $.command.run({ command: 'watch', args: '12' })
    pr.state = 'MERGED'
    await clock.advance(60_000)
    expect((await bash($, 'sleep 60')).deny).toBeUndefined()
  })
})

describe('gh failures', () => {
  test('gh missing: a clear error, no crash, nothing watched', async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    world.gh = 'missing'
    engineBelow(on, world)
    await start($)
    const reply = await $.command.run({ command: 'watch', args: '12' })
    expect(reply.text).toContain('GitHub CLI')
    await clock.advance(60_000)
    expect((await bash($, 'sleep 60')).deny).toBeUndefined()
  })

  test('gh unauthenticated: a clear error, no crash', async ($, on) => {
    mock.clock(on)
    const world = newWorld()
    world.gh = 'unauthenticated'
    engineBelow(on, world)
    await start($)
    const reply = await $.command.run({ command: 'watch', args: '12' })
    expect(reply.text).toContain('gh auth login')
  })

  test('gh failing mid-watch toasts once, keeps the watch and recovers', async ($, on) => {
    const clock = mock.clock(on)
    const pr = fakePr()
    const world = newWorld({ 12: pr })
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'watch', args: '12' })
    world.gh = 'unauthenticated'
    await clock.advance(60_000)
    await clock.advance(60_000)
    expect(seen.toasts.filter(text => text.includes('gh auth login'))).toHaveLength(1)
    expect(seen.statuses.at(-1)).toBe('SENTRY #12 CI░ REV░ 0T ERR')
    expect((await bash($, 'sleep 60')).deny).toBeDefined()
    world.gh = 'ok'
    pr.runs[SHA] = [LINT_FAILED]
    await clock.advance(60_000)
    expect(seen.prompts).toHaveLength(1)
    expect(seen.statuses.at(-1)).toBe('SENTRY #12 CIX REV░ 0T')
  })

  test('unreadable check-runs show ERR and CI UNKNOWN, toast once and recover', async ($, on) => {
    const clock = mock.clock(on)
    const pr = fakePr({ runs: { [SHA]: [UNIT_RUNNING] } })
    const world = newWorld({ 12: pr })
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'watch', args: '12' })
    world.gh = 'checks-forbidden'
    pr.headRefOid = 'fff9999aaa'
    pr.runs['fff9999aaa'] = [LINT_FAILED]
    await clock.advance(60_000)
    await clock.advance(60_000)
    const errors = seen.toasts.filter(text => text.includes('HTTP 403'))
    expect(errors).toEqual(['SENTRY #12: CI unknown: gh failed: gh: Resource not accessible by personal access token (HTTP 403)'])
    expect(seen.statuses.at(-1)).toBe('SENTRY #12 CI? REV░ 0T ERR')
    const state = await $.tool.call({ tool: 'mcp__sentry__pr_state', pr: 12 })
    expect(JSON.stringify(state.result)).toContain('CI UNKNOWN (check-runs unreadable: gh failed')
    expect(JSON.stringify(state.result)).not.toContain('no check-runs yet')
    expect(seen.prompts).toEqual([])
    world.gh = 'ok'
    await clock.advance(60_000)
    expect(seen.prompts).toEqual(['SENTRY: PR #12 CI FAILED on fff9999 — failed checks: "lint". Investigate.'])
    expect(seen.statuses.at(-1)).toBe('SENTRY #12 CIX REV░ 0T')
  })

  test('a gh that times out says so, not that gh is missing', async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'watch', args: '12' })
    world.gh = 'hang'
    world.hang = milliseconds => clock.sleep(milliseconds)
    await clock.advance(60_000)
    expect(seen.toasts).toEqual([])
    await clock.advance(30_000)
    expect(seen.toasts).toEqual(['SENTRY #12: gh timed out after 30s (network?); sentry will try again next poll.'])
    const pending = $.tool.call({ tool: 'mcp__sentry__pr_state', pr: 12 })
    await clock.advance(30_000)
    const state = await pending
    expect(JSON.stringify(state.result)).toContain('gh timed out after 30s')
    expect(JSON.stringify(state.result)).not.toContain('install')
  })

  test('pr_state reports a gh failure as an error result, not a crash', async ($, on) => {
    mock.clock(on)
    const world = newWorld()
    world.gh = 'missing'
    engineBelow(on, world)
    await start($)
    const state = await $.tool.call({ tool: 'mcp__sentry__pr_state', pr: 12 })
    expect(JSON.stringify(state.result)).toContain('GitHub CLI')
  })
})

describe('pr_state tool', () => {
  test('returns the same truth snapshot for every watched PR', async ($, on) => {
    mock.clock(on)
    const other = 'bbb2222ccc'
    engineBelow(on, newWorld({ 12: fakePr({ runs: { [SHA]: [LINT_FAILED] } }), 14: fakePr({ headRefOid: other, runs: { [other]: [] } }) }))
    await start($)
    await $.command.run({ command: 'watch', args: '12' })
    await $.command.run({ command: 'watch', args: '14' })
    const state = await $.tool.call({ tool: 'mcp__sentry__pr_state' })
    const text = JSON.stringify(state.result)
    expect(text).toContain('PR #12 OPEN on abc1234: CI FAILED (\\"lint\\")')
    expect(text).toContain('PR #14 OPEN on bbb2222: CI PENDING')
  })

  test('asks for nothing watched when nothing is', async ($, on) => {
    mock.clock(on)
    engineBelow(on, newWorld())
    await start($)
    const state = await $.tool.call({ tool: 'mcp__sentry__pr_state' })
    expect(JSON.stringify(state.result)).toContain('No PRs are watched')
  })
})
