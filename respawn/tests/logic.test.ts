import { describe, expect, test } from 'claude-code/testing'

import {
  BACKOFF_SECONDS,
  HOUR_MS,
  IDLE_RUN,
  backoffSeconds,
  cancelRun,
  continuePrompt,
  describeRun,
  hearts,
  isOwnPrompt,
  isUserPrompt,
  livesLeft,
  minutesToNextLife,
  spendLife,
  startCountdown,
  statusLine,
  tickRun,
} from '../hooks/logic'

describe('backoff', () => {
  test('climbs 10s, 30s, 60s, 120s, 300s and stays at 300s', () => {
    expect(BACKOFF_SECONDS).toEqual([10, 30, 60, 120, 300])
    expect([0, 1, 2, 3, 4, 5, 9].map(backoffSeconds)).toEqual([10, 30, 60, 120, 300, 300, 300])
  })
})

describe('lives', () => {
  test('only spends from the last hour count', () => {
    const now = 10 * HOUR_MS
    expect(livesLeft([], 3, now)).toBe(3)
    expect(livesLeft([now - 1000, now - 2000], 3, now)).toBe(1)
    expect(livesLeft([now - HOUR_MS - 1, now - 5], 3, now)).toBe(2)
    expect(livesLeft([now, now, now, now], 3, now)).toBe(0)
  })

  test('hearts draw full then empty', () => {
    expect(hearts(2, 3)).toBe('♥♥♡')
    expect(hearts(0, 3)).toBe('♡♡♡')
    expect(hearts(3, 3)).toBe('♥♥♥')
  })
})

describe('run transitions', () => {
  const now = 5 * HOUR_MS

  test('an error starts a countdown at the current backoff step', () => {
    const run = startCountdown({ ...IDLE_RUN, attempt: 2 }, now, 3)
    expect(run).toMatchObject({ phase: 'countdown', dueAt: now + 60_000, secondsLeft: 60 })
  })

  test('with no lives left an error is GAME OVER', () => {
    const run = startCountdown({ ...IDLE_RUN, spentAt: [now - 1, now - 2, now - 3] }, now, 3)
    expect(run.phase).toBe('gameover')
  })

  test('spending a life steps the backoff and records the time', () => {
    const run = spendLife({ ...startCountdown(IDLE_RUN, now, 3) }, now + 10_000)
    expect(run).toMatchObject({ phase: 'idle', attempt: 1, spentAt: [now + 10_000] })
  })

  test('cancel resets the backoff but keeps the spent lives and the switch', () => {
    const run = cancelRun({ ...IDLE_RUN, phase: 'countdown', attempt: 3, spentAt: [now], isOff: true })
    expect(run).toMatchObject({ phase: 'idle', attempt: 0, spentAt: [now], isOff: true })
  })

  test('tick counts whole seconds down to zero', () => {
    const run = startCountdown(IDLE_RUN, now, 3)
    expect(tickRun(run, now + 1).secondsLeft).toBe(10)
    expect(tickRun(run, now + 1000).secondsLeft).toBe(9)
    expect(tickRun(run, now + 99_000).secondsLeft).toBe(0)
  })
})

describe('prompt origins', () => {
  test('respawn knows its own prompt', () => {
    expect(isOwnPrompt({ kind: 'plugin', name: 'respawn', asUser: true })).toBe(true)
    expect(isOwnPrompt({ kind: 'plugin', name: 'sentry' })).toBe(false)
    expect(isOwnPrompt({ kind: 'composer' })).toBe(false)
  })

  test('the person typing, the bridge and the SDK are the user', () => {
    expect(isUserPrompt({ kind: 'composer' })).toBe(true)
    expect(isUserPrompt({ kind: 'bridge' })).toBe(true)
    expect(isUserPrompt({ kind: 'sdk' })).toBe(true)
    expect(isUserPrompt({ kind: 'task-notification' })).toBe(false)
    expect(isUserPrompt({ kind: 'plugin', name: 'respawn' })).toBe(false)
  })

  test('the continue prompt falls back to "continue"', () => {
    expect(continuePrompt('')).toBe('continue')
    expect(continuePrompt('   ')).toBe('continue')
    expect(continuePrompt(undefined)).toBe('continue')
    expect(continuePrompt('keep going')).toBe('keep going')
  })
})

describe('text', () => {
  const now = 2 * HOUR_MS

  test('status line is short and arcade', () => {
    const line = statusLine(startCountdown(IDLE_RUN, now, 3), 3, now)
    expect(line).toBe('RESPAWN CONTINUE? 10 ♥♥♥')
    expect(line?.length ?? 99).toBeLessThanOrEqual(40)
    expect(statusLine({ ...IDLE_RUN, phase: 'gameover', spentAt: [now, now, now] }, 3, now)).toBe(
      'RESPAWN GAME OVER ♡♡♡',
    )
    expect(statusLine(IDLE_RUN, 3, now)).toBeUndefined()
  })

  test('/respawn describes the state', () => {
    expect(describeRun(IDLE_RUN, 3, now)).toContain('READY')
    expect(describeRun(IDLE_RUN, 3, now)).toContain('♥♥♥')
    expect(describeRun(startCountdown(IDLE_RUN, now, 3), 3, now)).toContain('CONTINUE? 10')
    expect(describeRun({ ...IDLE_RUN, isOff: true }, 3, now)).toContain('OFF')
    expect(describeRun({ ...IDLE_RUN, phase: 'gameover' }, 3, now)).toContain('GAME OVER')
  })
})

describe('GAME OVER', () => {
  const now = 10_000_000
  test('a new error in GAME OVER keeps GAME OVER, even with lives back', () => {
    const over = startCountdown({ ...IDLE_RUN, spentAt: [now, now, now] }, now, 3)
    expect(over.phase).toBe('gameover')
    expect(over.minutesToLife).toBe(60)
    const later = startCountdown(over, now + 2 * 60 * 60 * 1000, 3)
    expect(later.phase).toBe('gameover')
    expect(later.spentAt).toEqual([])
    expect(later.minutesToLife).toBe(0)
  })

  test('minutes to the next life round up and never show 0 while one is spent', () => {
    expect(minutesToNextLife([], now)).toBe(0)
    expect(minutesToNextLife([now - 59 * 60_000 - 59_000], now)).toBe(1)
    expect(minutesToNextLife([now - 30 * 60_000], now)).toBe(30)
  })
})
