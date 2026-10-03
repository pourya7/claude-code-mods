import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

type Run = { name: string; status: string; conclusion: string | null }
type FakeDeployment = { id: number; environment: string; created_at: string }
type World = {
  repo: string
  prs: Record<number, { state: string; title: string; mergeSha: string | null }>
  commits: Record<string, string>
  runs: Record<string, Run[]>
  deployments: Record<string, FakeDeployment[]>
  statuses: Record<number, string[]>
  gh: 'ok' | 'missing' | 'unauthenticated'
  calls: string[][]
  live: { status: number; text: string } | 'throw'
  fetched: string[]
  /** Set: the next workflow-runs read waits on it (a poll still in flight), then clears. */
  holdRuns: (() => Promise<void>) | null
  /** Set: a prompt.submit hook beneath refuses the prompt with this reason. */
  dropPrompt: string | null
}
type Seen = { prompts: string[]; toasts: string[]; statuses: (string | undefined)[]; opened: string[] }

const SHA = 'abc1234def5678abc1234def5678abc1234def56'
const PASSED: Run = { name: 'ci', status: 'completed', conclusion: 'success' }
const RUNNING: Run = { name: 'ci', status: 'in_progress', conclusion: null }
const FAILED: Run = { name: 'ci', status: 'completed', conclusion: 'failure' }
const MINUTE = 60_000

function newWorld(): World {
  return {
    repo: 'acme/app',
    prs: { 42: { state: 'MERGED', title: 'Add login retry', mergeSha: SHA } },
    commits: { [SHA]: 'Add login retry (#42)' },
    runs: { [SHA]: [RUNNING] },
    deployments: { [SHA]: [] },
    statuses: {},
    gh: 'ok',
    calls: [],
    live: { status: 200, text: '{"version":"old0000"}' },
    fetched: [],
    holdRuns: null,
    dropPrompt: null,
  }
}

function ok(body: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(body), stderr: '' }
}

function answerGh(world: World, argv: readonly string[]) {
  world.calls.push([...argv])
  if (world.gh === 'missing') throw new Error('spawn gh ENOENT')
  if (world.gh === 'unauthenticated') return { exitCode: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' }
  if (argv[1] === 'repo') return { exitCode: 0, stdout: `${world.repo}\n`, stderr: '' }
  if (argv[1] === 'pr') {
    const number = Number(argv[3])
    const pr = world.prs[number]
    if (!pr) return { exitCode: 1, stdout: '', stderr: `GraphQL: Could not resolve to a PullRequest with the number of ${number}.` }
    return ok({ number, title: pr.title, state: pr.state, mergeCommit: pr.mergeSha ? { oid: pr.mergeSha } : null })
  }
  const path = argv[2] ?? ''
  const commit = /^repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]+)$/.exec(path)
  if (commit) {
    const full = Object.keys(world.commits).find(sha => sha.startsWith(commit[1] ?? '-'))
    if (!full) return { exitCode: 1, stdout: '', stderr: 'gh: No commit found for SHA (HTTP 422)' }
    return ok({ sha: full, commit: { message: `${world.commits[full]}\n\nbody` } })
  }
  const runs = /actions\/runs\?head_sha=([0-9a-f]+)&per_page=100$/.exec(path)
  if (runs) return ok({ total_count: (world.runs[runs[1] ?? ''] ?? []).length, workflow_runs: world.runs[runs[1] ?? ''] ?? [] })
  const deployments = /deployments\?sha=([0-9a-f]+)&per_page=100$/.exec(path)
  if (deployments) return ok(world.deployments[deployments[1] ?? ''] ?? [])
  const statuses = /deployments\/(\d+)\/statuses\?per_page=1$/.exec(path)
  if (statuses) return ok((world.statuses[Number(statuses[1])] ?? []).map(state => ({ state })))
  return { exitCode: 1, stdout: '', stderr: `unexpected gh call: ${argv.join(' ')}` }
}

function engineBelow(on: On, world: World): Seen {
  const seen: Seen = { prompts: [], toasts: [], statuses: [], opened: [] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.run', async ($, e) => {
    const hold = world.holdRuns
    if (hold !== null && e.argv[2]?.includes('actions/runs')) {
      world.holdRuns = null
      await hold()
    }
    return { value: answerGh(world, e.argv) }
  })
  on('http.fetch', ($, e) => {
    world.fetched.push(e.url)
    if (world.live === 'throw') throw new Error('connect ECONNREFUSED')
    return { value: { status: world.live.status, ok: world.live.status < 300, headers: {}, text: world.live.text } }
  })
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text)
    return world.dropPrompt === null ? { text: e.text } : { drop: world.dropPrompt }
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
  return seen
}

async function start($: Engine) {
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
}

function deploy(world: World, environment: string, id: number, states: string[], minute = 0) {
  world.deployments[SHA] = [...(world.deployments[SHA] ?? []), { id, environment, created_at: `2026-10-01T10:${String(minute).padStart(2, '0')}:00Z` }]
  world.statuses[id] = states
}

describe('/trace', () => {
  test('/trace <pr> resolves the merge commit with gh pr view and shows the chain', async ($, on) => {
    mock.clock(on)
    const world = newWorld()
    const seen = engineBelow(on, world)
    await start($)
    const reply = await $.command.run({ command: 'trace', args: '42' })
    expect(world.calls[0]).toEqual(['gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
    expect(world.calls[1]).toEqual(['gh', 'pr', 'view', '42', '--repo', 'acme/app', '--json', 'number,title,state,mergeCommit'])
    expect(world.calls.some(argv => argv[2] === `repos/acme/app/actions/runs?head_sha=${SHA}&per_page=100`)).toBe(true)
    expect(world.calls.some(argv => argv[2] === `repos/acme/app/deployments?sha=${SHA}&per_page=100`)).toBe(true)
    expect(reply.text).toContain('PR #42 (abc1234)')
    expect(reply.text).toContain('★ MERGED ▸ ● BUILD')
    expect(seen.statuses.at(-1)).toBe('TRACER #42 ★● BUILD')
  })

  test('/trace <sha> resolves a short SHA to the full one', async ($, on) => {
    mock.clock(on)
    const world = newWorld()
    engineBelow(on, world)
    await start($)
    const reply = await $.command.run({ command: 'trace', args: 'acme/app@abc1234' })
    expect(world.calls[0]).toEqual(['gh', 'api', 'repos/acme/app/commits/abc1234'])
    expect(world.calls.some(argv => argv[2]?.includes(`head_sha=${SHA}`))).toBe(true)
    expect(reply.text).toContain('abc1234')
  })

  test('a PR that is not merged is not traced', async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    world.prs[42] = { state: 'OPEN', title: 'Add login retry', mergeSha: null }
    engineBelow(on, world)
    await start($)
    const reply = await $.command.run({ command: 'trace', args: '42' })
    expect(reply.text).toContain('not merged yet')
    world.calls.length = 0
    await clock.advance(MINUTE)
    expect(world.calls).toEqual([])
  })

  test('a bad argument says how to use it', async ($, on) => {
    mock.clock(on)
    engineBelow(on, newWorld())
    await start($)
    const reply = await $.command.run({ command: 'trace', args: 'main' })
    expect(reply.text).toContain('/trace 42')
  })

  test('/trace with no argument opens the pane', async ($, on) => {
    mock.clock(on)
    const seen = engineBelow(on, newWorld())
    await start($)
    const reply = await $.command.run({ command: 'trace' })
    expect(seen.opened).toEqual(['tracer'])
    expect(reply.text).toContain('/trace 42')
  })

  test('/trace stop ends every trace and clears the status line', async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'trace', args: '42' })
    const reply = await $.command.run({ command: 'trace', args: 'stop' })
    expect(reply.text).toContain('stopped')
    expect(seen.statuses.at(-1)).toBeUndefined()
    world.calls.length = 0
    await clock.advance(MINUTE)
    expect(world.calls).toEqual([])
  })

  test('gh missing or unauthenticated is a clear reply, not a crash', async ($, on) => {
    mock.clock(on)
    const world = newWorld()
    engineBelow(on, world)
    await start($)
    world.gh = 'missing'
    expect((await $.command.run({ command: 'trace', args: 'acme/app#42' })).text).toContain('install the GitHub CLI')
    world.gh = 'unauthenticated'
    expect((await $.command.run({ command: 'trace', args: 'acme/app#42' })).text).toContain('gh auth login')
  })
})

describe('stage progression', () => {
  test('BUILD, then DEPLOY:<env>, then LIVE, polled every interval', { options: { liveUrl: 'https://app.example.com/version?v={short}', environments: 'production' } }, async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'trace', args: '42' })
    expect(seen.statuses.at(-1)).toBe('TRACER #42 ★●●● BUILD')

    world.runs[SHA] = [PASSED]
    await clock.advance(MINUTE)
    expect(seen.toasts.at(-1)).toBe('TRACER #42 ★ BUILD')
    expect(seen.statuses.at(-1)).toBe('TRACER #42 ★★●● DEPLOY:PRODUCTION')
    expect(world.fetched).toEqual([])

    deploy(world, 'production', 7, ['in_progress'])
    await clock.advance(MINUTE)
    expect(seen.statuses.at(-1)).toBe('TRACER #42 ★★●● DEPLOY:PRODUCTION')

    world.statuses[7] = ['success', 'in_progress']
    await clock.advance(MINUTE)
    expect(seen.toasts.at(-1)).toBe('TRACER #42 ★ DEPLOY:PRODUCTION')
    expect(world.fetched).toEqual(['https://app.example.com/version?v=abc1234'])
    expect(seen.statuses.at(-1)).toBe('TRACER #42 ★★★● LIVE')
    expect(seen.prompts).toEqual([])

    world.live = { status: 200, text: `{"version":"${SHA}"}` }
    await clock.advance(MINUTE)
    expect(seen.toasts.at(-1)).toBe('TRACER #42 ★ LIVE')
    expect(seen.statuses.at(-1)).toBe('TRACER #42 ★★★★ CLEAR!')
    expect(seen.prompts).toEqual(['TRACER: PR #42 (abc1234) is LIVE — MERGED ▸ BUILD ▸ DEPLOY:PRODUCTION ▸ LIVE in 4m.'])

    world.calls.length = 0
    await clock.advance(MINUTE)
    await clock.advance(MINUTE)
    expect(world.calls).toEqual([])
    expect(seen.prompts).toHaveLength(1)
  })

  test('a live URL that errors stays pending and is retried', { options: { liveUrl: 'https://app.example.com/version' } }, async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    world.runs[SHA] = [PASSED]
    world.live = 'throw'
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'trace', args: '42' })
    expect(seen.statuses.at(-1)).toBe('TRACER #42 ★★● LIVE')
    world.live = { status: 200, text: 'abc1234' }
    await clock.advance(MINUTE)
    expect(seen.prompts).toHaveLength(1)
    expect(world.fetched).toHaveLength(2)
  })

  test('liveMatch decides when the body counts as live', { options: { liveUrl: 'https://app.example.com/version', liveMatch: '"ready":true' } }, async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    world.runs[SHA] = [PASSED]
    world.live = { status: 200, text: `{"sha":"${SHA}","ready":false}` }
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'trace', args: '42' })
    await clock.advance(MINUTE)
    expect(seen.prompts).toEqual([])
    world.live = { status: 200, text: '{"ready":true}' }
    await clock.advance(MINUTE)
    expect(seen.prompts).toHaveLength(1)
  })
})

describe('no deployments configured', () => {
  test('BUILD is the final stage and wakes once', async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'trace', args: '42' })
    world.runs[SHA] = [PASSED]
    await clock.advance(MINUTE)
    await clock.advance(MINUTE)
    expect(seen.prompts).toEqual(['TRACER: PR #42 (abc1234) reached BUILD — MERGED ▸ BUILD in 1m. No deployments to follow.'])
    expect(seen.statuses.at(-1)).toBe('TRACER #42 ★★ CLEAR!')
    expect(world.calls.some(argv => argv[2]?.includes('/statuses'))).toBe(false)
  })

  test('a chain already done at /trace is a baseline: the reply says so, no wake', async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    world.runs[SHA] = [PASSED]
    const seen = engineBelow(on, world)
    await start($)
    const reply = await $.command.run({ command: 'trace', args: '42' })
    expect(reply.text).toContain('ALREADY THERE')
    await clock.advance(MINUTE)
    expect(seen.prompts).toEqual([])
  })
})

describe('failure', () => {
  test('a failed build wakes once and stops polling', async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'trace', args: '42' })
    world.runs[SHA] = [FAILED, { ...PASSED, name: 'docs' }]
    await clock.advance(MINUTE)
    expect(seen.prompts).toEqual(['TRACER: PR #42 (abc1234) FAILED at BUILD — FAILED: "ci". Investigate.'])
    expect(seen.toasts.at(-1)).toBe('TRACER #42 ✕ BUILD FAILED')
    world.calls.length = 0
    await clock.advance(MINUTE)
    await clock.advance(MINUTE)
    expect(world.calls).toEqual([])
    expect(seen.prompts).toHaveLength(1)
  })

  test('a failed deployment wakes once', async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    world.runs[SHA] = [PASSED]
    deploy(world, 'staging', 3, ['in_progress'])
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'trace', args: '42' })
    world.statuses[3] = ['failure']
    await clock.advance(MINUTE)
    await clock.advance(MINUTE)
    expect(seen.prompts).toEqual(['TRACER: PR #42 (abc1234) FAILED at DEPLOY:STAGING — FAILURE. Investigate.'])
  })

  test('wake: never toasts but submits nothing', { options: { wake: 'never' } }, async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'trace', args: '42' })
    world.runs[SHA] = [FAILED]
    await clock.advance(MINUTE)
    expect(seen.prompts).toEqual([])
    expect(seen.toasts.at(-1)).toBe('TRACER #42 ✕ BUILD FAILED')
  })

  test('a gh error during polling toasts once and keeps tracing', async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'trace', args: '42' })
    world.gh = 'unauthenticated'
    await clock.advance(MINUTE)
    await clock.advance(MINUTE)
    expect(seen.toasts.filter(text => text.includes('gh auth login'))).toHaveLength(1)
    expect(seen.statuses.at(-1)).toBe('TRACER #42 ★● BUILD ERR')
    world.gh = 'ok'
    world.runs[SHA] = [PASSED]
    await clock.advance(MINUTE)
    expect(seen.prompts).toHaveLength(1)
    expect(seen.statuses.at(-1)).toBe('TRACER #42 ★★ CLEAR!')
  })
})

describe('a poll in flight', () => {
  test('a trace stopped while its poll is in flight does not wake or toast', async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'trace', args: '42' })
    world.runs[SHA] = [FAILED]
    world.holdRuns = () => clock.sleep(10_000)
    await clock.advance(MINUTE)
    expect((await $.command.run({ command: 'trace', args: 'stop 42' })).text).toContain('stopped #42')
    const toasts = seen.toasts.length
    await clock.advance(10_000)
    expect(seen.prompts).toEqual([])
    expect(seen.toasts).toHaveLength(toasts)
    expect(seen.statuses.at(-1)).toBeUndefined()
  })

  test('a fresh /trace of the same commit during a poll is not overwritten by the stale one', async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'trace', args: '42' })
    world.holdRuns = () => clock.sleep(10_000)
    await clock.advance(MINUTE)
    world.runs[SHA] = [PASSED]
    expect((await $.command.run({ command: 'trace', args: '42' })).text).toContain('ALREADY THERE')
    await clock.advance(10_000)
    expect(seen.prompts).toEqual([])
    expect(seen.statuses.at(-1)).toBe('TRACER #42 ★★ CLEAR!')
  })
})

describe('a refused wake', () => {
  test('a prompt.submit hook that drops the wake prompt is toasted', async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    world.dropPrompt = 'no'
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'trace', args: '42' })
    world.runs[SHA] = [FAILED]
    await clock.advance(MINUTE)
    expect(seen.prompts).toHaveLength(1)
    expect(seen.toasts.at(-1)).toBe('TRACER: wake refused: no')
  })
})

describe('timeout', () => {
  test('polling stops after timeoutMinutes, with a toast and no wake', { options: { timeoutMinutes: 5 } }, async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    const seen = engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'trace', args: '42' })
    for (let minute = 0; minute < 5; minute += 1) await clock.advance(MINUTE)
    expect(seen.toasts.at(-1)).toBe('TRACER #42 TIME UP AT BUILD')
    expect(seen.statuses.at(-1)).toBe('TRACER #42 ★● TIME UP')
    expect(seen.prompts).toEqual([])
    world.calls.length = 0
    await clock.advance(MINUTE)
    expect(world.calls).toEqual([])
  })
})

describe('reload', () => {
  test('a second session.start does not double the polling', async ($, on) => {
    const clock = mock.clock(on)
    const world = newWorld()
    engineBelow(on, world)
    await start($)
    await $.command.run({ command: 'trace', args: '42' })
    await start($)
    world.calls.length = 0
    await clock.advance(MINUTE)
    expect(world.calls.filter(argv => argv[2]?.includes('actions/runs'))).toHaveLength(1)
  })
})
