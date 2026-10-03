import { describe, expect, test } from 'claude-code/testing'

import type { TracerStage, TracerTrace } from '../types'
import {
  buildStages,
  cleanName,
  currentStage,
  isLiveBody,
  latestPerEnvironment,
  liveUrlFor,
  needsLiveCheck,
  outcomeOf,
  parseEnvironments,
  stageLabel,
  statusLine,
  toastText,
  wakeLine,
} from '../hooks/chain'
import type { DeploymentState, WorkflowRun } from '../hooks/chain'

const SHA = 'abc1234def5678abc1234def5678abc1234def56'
const PASSED: WorkflowRun = { name: 'ci', status: 'completed', conclusion: 'success' }
const RUNNING: WorkflowRun = { name: 'deploy', status: 'in_progress', conclusion: null }
const FAILED: WorkflowRun = { name: 'ci', status: 'completed', conclusion: 'failure' }

function deployment(environment: string, state: string | null, createdAt = '2026-10-01T10:00:00Z', id = 1): DeploymentState {
  return { id, environment, createdAt, state }
}

function states(stages: TracerStage[]): string[] {
  return stages.map(stage => `${stage.id}=${stage.state}`)
}

function trace(over: Partial<TracerTrace> = {}): TracerTrace {
  return {
    repo: 'acme/app',
    sha: SHA,
    pr: 42,
    title: 'Add login retry',
    startedAt: 0,
    checkedAt: 0,
    stages: buildStages({ runs: [PASSED], deployments: [], environments: [], hasLiveUrl: false, live: null }),
    outcome: 'tracing',
    hasWoken: false,
    error: null,
    ...over,
  }
}

describe('stage progression', () => {
  test('no runs yet: MERGED done, BUILD pending', () => {
    const stages = buildStages({ runs: [], deployments: [], environments: [], hasLiveUrl: false, live: null })
    expect(states(stages)).toEqual(['merged=done', 'build=pending'])
    expect(stages[1]?.detail).toBe('NO RUNS YET')
  })

  test('a running workflow keeps BUILD pending', () => {
    const stages = buildStages({ runs: [PASSED, RUNNING], deployments: [], environments: [], hasLiveUrl: false, live: null })
    expect(states(stages)).toEqual(['merged=done', 'build=pending'])
    expect(stages[1]?.detail).toBe('1 RUNNING, 1 PASSED')
  })

  test('every run passed: BUILD done', () => {
    const skipped: WorkflowRun = { name: 'docs', status: 'completed', conclusion: 'skipped' }
    const stages = buildStages({ runs: [PASSED, skipped], deployments: [], environments: [], hasLiveUrl: false, live: null })
    expect(states(stages)).toEqual(['merged=done', 'build=done'])
    expect(stages[1]?.detail).toBe('2/2 RUNS PASSED')
  })

  test('a failed run fails BUILD and names it', () => {
    const stages = buildStages({ runs: [PASSED, FAILED, { ...FAILED, name: 'lint', conclusion: 'timed_out' }], deployments: [], environments: [], hasLiveUrl: false, live: null })
    expect(stages[1]?.state).toBe('failed')
    expect(stages[1]?.detail).toBe('FAILED: "ci", "lint"')
  })

  test('a cancelled run fails BUILD; one waiting for approval keeps it pending', () => {
    const cancelled = buildStages({ runs: [{ ...FAILED, conclusion: 'cancelled' }], deployments: [], environments: [], hasLiveUrl: false, live: null })
    expect(cancelled[1]?.state).toBe('failed')
    const approval = buildStages({ runs: [{ ...FAILED, conclusion: 'action_required' }], deployments: [], environments: [], hasLiveUrl: false, live: null })
    expect(approval[1]?.state).toBe('pending')
    expect(approval[1]?.detail).toBe('1 WAITING FOR APPROVAL')
  })

  test('deployments add one DEPLOY stage per environment, in the order they appeared', () => {
    const stages = buildStages({
      runs: [PASSED],
      deployments: [
        deployment('production', 'in_progress', '2026-10-01T10:05:00Z', 2),
        deployment('staging', 'success', '2026-10-01T10:00:00Z', 1),
      ],
      environments: [],
      hasLiveUrl: false,
      live: null,
    })
    expect(states(stages)).toEqual(['merged=done', 'build=done', 'deploy:staging=done', 'deploy:production=pending'])
    expect(stages[3]?.detail).toBe('IN PROGRESS')
  })

  test('the newest deployment of an environment wins', () => {
    const stages = buildStages({
      runs: [PASSED],
      deployments: [deployment('staging', 'failure', '2026-10-01T10:00:00Z', 1), deployment('staging', 'success', '2026-10-01T10:09:00Z', 2)],
      environments: [],
      hasLiveUrl: false,
      live: null,
    })
    expect(states(stages)).toEqual(['merged=done', 'build=done', 'deploy:staging=done'])
  })

  test('deploy states: inactive is done, error and failure fail, no status yet is pending', () => {
    const one = (state: string | null) =>
      buildStages({ runs: [PASSED], deployments: [deployment('production', state)], environments: [], hasLiveUrl: false, live: null })[2]
    expect(one('inactive')?.state).toBe('done')
    expect(one('error')?.state).toBe('failed')
    expect(one('failure')?.state).toBe('failed')
    expect(one(null)?.state).toBe('pending')
    expect(one(null)?.detail).toBe('NO STATUS YET')
  })

  test('configured environments come first and wait even before any deployment exists', () => {
    const stages = buildStages({
      runs: [PASSED],
      deployments: [deployment('preview', 'success')],
      environments: ['staging', 'Production'],
      hasLiveUrl: false,
      live: null,
    })
    expect(states(stages)).toEqual(['merged=done', 'build=done', 'deploy:staging=pending', 'deploy:Production=pending', 'deploy:preview=done'])
    expect(stages[2]?.detail).toBe('NO DEPLOYMENT YET')
  })

  test('configured environments match deployments without regard to case', () => {
    const stages = buildStages({ runs: [PASSED], deployments: [deployment('production', 'success')], environments: ['Production'], hasLiveUrl: false, live: null })
    expect(states(stages)).toEqual(['merged=done', 'build=done', 'deploy:Production=done'])
  })

  test('no deployments configured: BUILD is the final stage', () => {
    const stages = buildStages({ runs: [PASSED], deployments: [], environments: [], hasLiveUrl: false, live: null })
    expect(stages.at(-1)?.kind).toBe('build')
    expect(outcomeOf(stages, 0, 1000, 60_000)).toBe('done')
  })

  test('a live URL adds LIVE, which waits for the deploys before it is checked', () => {
    const before = buildStages({ runs: [PASSED], deployments: [deployment('production', 'in_progress')], environments: [], hasLiveUrl: true, live: null })
    expect(states(before)).toEqual(['merged=done', 'build=done', 'deploy:production=pending', 'live=pending'])
    expect(before[3]?.detail).toBe('WAITS FOR DEPLOY')
    expect(needsLiveCheck(before)).toBe(false)
    const ready = buildStages({ runs: [PASSED], deployments: [deployment('production', 'success')], environments: [], hasLiveUrl: true, live: null })
    expect(needsLiveCheck(ready)).toBe(true)
    const live = buildStages({ runs: [PASSED], deployments: [deployment('production', 'success')], environments: [], hasLiveUrl: true, live: { isLive: true, detail: 'SHA SEEN' } })
    expect(states(live)).toEqual(['merged=done', 'build=done', 'deploy:production=done', 'live=done'])
    const notYet = buildStages({ runs: [PASSED], deployments: [], environments: [], hasLiveUrl: true, live: { isLive: false, detail: 'HTTP 200, SHA NOT SEEN YET' } })
    expect(notYet.at(-1)?.state).toBe('pending')
    expect(notYet.at(-1)?.detail).toBe('HTTP 200, SHA NOT SEEN YET')
  })

  test('needsLiveCheck is false without a LIVE stage or once a stage failed', () => {
    expect(needsLiveCheck(buildStages({ runs: [PASSED], deployments: [], environments: [], hasLiveUrl: false, live: null }))).toBe(false)
    expect(needsLiveCheck(buildStages({ runs: [FAILED], deployments: [], environments: [], hasLiveUrl: true, live: null }))).toBe(false)
  })

  test('currentStage is the first stage not done', () => {
    const stages = buildStages({ runs: [PASSED], deployments: [deployment('production', 'queued')], environments: [], hasLiveUrl: true, live: null })
    expect(currentStage(stages)?.id).toBe('deploy:production')
    expect(currentStage(buildStages({ runs: [PASSED], deployments: [], environments: [], hasLiveUrl: false, live: null }))).toBeUndefined()
  })
})

describe('outcome', () => {
  const pending = buildStages({ runs: [RUNNING], deployments: [], environments: [], hasLiveUrl: false, live: null })

  test('tracing while a stage is pending and time is left', () => {
    expect(outcomeOf(pending, 0, 59_999, 60_000)).toBe('tracing')
  })

  test('timeout once the time is up', () => {
    expect(outcomeOf(pending, 0, 60_000, 60_000)).toBe('timeout')
  })

  test('a failed stage beats the clock', () => {
    const failed = buildStages({ runs: [FAILED], deployments: [], environments: [], hasLiveUrl: false, live: null })
    expect(outcomeOf(failed, 0, 999_999, 60_000)).toBe('failed')
  })
})

describe('live URL', () => {
  test('{sha} and {short} are filled in, URL-encoded', () => {
    expect(liveUrlFor('https://api.example.com/version?sha={sha}&s={short}', SHA)).toBe(
      `https://api.example.com/version?sha=${SHA}&s=abc1234`,
    )
  })

  test('the body is live when it holds the full or the short SHA', () => {
    expect(isLiveBody(`{"version":"${SHA}"}`, SHA, '')).toBe(true)
    expect(isLiveBody('build abc1234 ok', SHA, '')).toBe(true)
    expect(isLiveBody('build fff0000 ok', SHA, '')).toBe(false)
  })

  test('liveMatch, with placeholders, replaces the SHA test', () => {
    expect(isLiveBody('release: r-abc1234', SHA, 'r-{short}')).toBe(true)
    expect(isLiveBody(`${SHA}`, SHA, 'r-{short}')).toBe(false)
    expect(isLiveBody('"ready":true', SHA, '"ready":true')).toBe(true)
  })
})

describe('text', () => {
  test('stage labels', () => {
    const stages = buildStages({ runs: [PASSED], deployments: [deployment('production', 'success')], environments: [], hasLiveUrl: true, live: null })
    expect(stages.map(stageLabel)).toEqual(['MERGED', 'BUILD', 'DEPLOY:PRODUCTION', 'LIVE'])
  })

  test('parseEnvironments splits on commas and drops blanks', () => {
    expect(parseEnvironments(' staging, production ,,')).toEqual(['staging', 'production'])
    expect(parseEnvironments(undefined)).toEqual([])
  })

  test('cleanName keeps plain characters and 40 columns', () => {
    expect(cleanName('ci\u001b[31m / build\n"x"')).toBe('ci31m / buildx')
    expect(cleanName('a'.repeat(60))).toHaveLength(40)
  })

  test('status line fits in 40 columns and shows the glyph per stage', () => {
    const stages = buildStages({ runs: [PASSED], deployments: [deployment('production-europe-west', 'in_progress')], environments: [], hasLiveUrl: true, live: null })
    const line = statusLine([trace({ stages })])
    expect(line).toBe('TRACER #42 ★★●● DEPLOY:PRODUCTION-EUROP~')
    expect(line?.length).toBeLessThanOrEqual(40)
  })

  test('status line for a raw SHA, a finished trace and more than one trace', () => {
    expect(statusLine([trace({ pr: null, outcome: 'done' })])).toBe('TRACER abc1234 ★★ CLEAR!')
    const failed = buildStages({ runs: [FAILED], deployments: [], environments: [], hasLiveUrl: false, live: null })
    expect(statusLine([trace({ stages: failed, outcome: 'failed' }), trace({ pr: 7 })])).toBe('TRACER #42 ★✕ BUILD FAILED +1')
    expect(statusLine([trace({ outcome: 'timeout', stages: buildStages({ runs: [], deployments: [], environments: [], hasLiveUrl: false, live: null }) })])).toBe(
      'TRACER #42 ★● TIME UP',
    )
    expect(statusLine([])).toBeUndefined()
  })

  test('status line names the stage that failed, not the first one still pending', () => {
    const stages = buildStages({ runs: [RUNNING], deployments: [deployment('production', 'failure')], environments: [], hasLiveUrl: false, live: null })
    expect(states(stages)).toEqual(['merged=done', 'build=pending', 'deploy:production=failed'])
    const failed = trace({ stages, outcome: outcomeOf(stages, 0, 0, Number.POSITIVE_INFINITY) })
    expect(failed.outcome).toBe('failed')
    expect(statusLine([failed])).toBe('TRACER #42 ★●✕ DEPLOY:PRODUCTION FAILED')
  })

  test('wake line when the chain is done', () => {
    const stages = buildStages({ runs: [PASSED], deployments: [deployment('production', 'success')], environments: [], hasLiveUrl: true, live: { isLive: true, detail: 'SHA SEEN' } })
    expect(wakeLine(trace({ stages, outcome: 'done' }), 14 * 60_000)).toBe(
      'TRACER: PR #42 (abc1234) is LIVE — MERGED ▸ BUILD ▸ DEPLOY:PRODUCTION ▸ LIVE in 14m.',
    )
  })

  test('wake line when BUILD is the last stage', () => {
    expect(wakeLine(trace({ pr: null, outcome: 'done' }), 90_000)).toBe('TRACER: abc1234 reached BUILD — MERGED ▸ BUILD in 1m. No deployments to follow.')
  })

  test('wake line when a stage failed', () => {
    const stages = buildStages({ runs: [FAILED], deployments: [], environments: [], hasLiveUrl: false, live: null })
    expect(wakeLine(trace({ stages, outcome: 'failed' }), 60_000)).toBe('TRACER: PR #42 (abc1234) FAILED at BUILD — FAILED: "ci". Investigate.')
  })

  test('toasts name the stages that moved', () => {
    const before = buildStages({ runs: [RUNNING], deployments: [], environments: [], hasLiveUrl: false, live: null })
    const after = buildStages({ runs: [PASSED], deployments: [deployment('staging', 'queued')], environments: [], hasLiveUrl: false, live: null })
    expect(toastText(trace({ stages: before }), trace({ stages: after }))).toBe('TRACER #42 ★ BUILD')
    const failed = buildStages({ runs: [FAILED], deployments: [], environments: [], hasLiveUrl: false, live: null })
    expect(toastText(trace({ stages: before }), trace({ stages: failed, outcome: 'failed' }))).toBe('TRACER #42 ✕ BUILD FAILED')
    expect(toastText(trace({ stages: before }), trace({ stages: before }))).toBeNull()
    expect(toastText(trace({ stages: before }), trace({ stages: before, outcome: 'timeout' }))).toBe('TRACER #42 TIME UP AT BUILD')
  })
})

describe('latestPerEnvironment', () => {
  test('keeps the newest deployment of each environment, names compared without case', () => {
    const list = [
      { id: 1, environment: 'production', createdAt: '2026-10-01T10:00:00Z' },
      { id: 2, environment: 'Production', createdAt: '2026-10-01T10:05:00Z' },
      { id: 3, environment: 'staging', createdAt: '2026-10-01T09:00:00Z' },
    ]
    expect(latestPerEnvironment(list).map(one => one.id).sort()).toEqual([2, 3])
  })
})
