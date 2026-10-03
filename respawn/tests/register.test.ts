import type { On, PromptSubmitInput, TurnCompleteReason } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}
const PRESENTATION = { isFullscreen: false, columns: 80 }

/** The world beneath respawn: a mocked clock and an engine that records every prompt. */
const world = (on: On) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const submitted: PromptSubmitInput[] = []
  on('prompt.submit', (_$, e) => {
    submitted.push(e)
    return { text: e.text }
  })
  on('prompt.edit', (_$, e) => ({ text: e.text + e.inputText, cursor: e.cursor + e.inputText.length }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', () => ({ type: 'Box' }))
  const statuses: (string | undefined)[] = []
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  return { clock, submitted, statuses, continues: () => submitted.filter(p => p.origin.kind === 'plugin') }
}

let turns = 0
const endTurn = ($: Engine, reason: TurnCompleteReason, agentId?: string) =>
  reason === 'refusal'
    ? $.turn.complete({
        answer: '',
        durationMs: 5,
        isAborted: false,
        turnId: `t${(turns += 1)}`,
        reason,
        refusal: { explanation: 'no' } as never,
      })
    : $.turn.complete({
        answer: '',
        durationMs: 5,
        isAborted: reason === 'aborted',
        turnId: `t${(turns += 1)}`,
        reason,
        ...(agentId ? { agentId } : {}),
      })

const typePrompt = ($: Engine, text: string) =>
  $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false } as never)

const respawnCommand = ($: Engine, args: string) =>
  $.command.run({ command: 'respawn', args, origin: { kind: 'composer' }, presentation: PRESENTATION } as never)

const band = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'respawn', surface, component: 'AbovePrompt', props: BAND })

describe('trigger', () => {
  test('only a main-loop error starts a respawn', async ($, on) => {
    const { clock, continues } = world(on)
    for (const reason of ['answer', 'aborted', 'refusal'] as const) await endTurn($, reason)
    await endTurn($, 'error', 'subagent-1')
    await clock.advance(600_000)
    expect(continues()).toHaveLength(0)

    await endTurn($, 'error')
    await clock.advance(9_000)
    expect(continues()).toHaveLength(0)
    await clock.advance(1_000)
    expect(continues()).toHaveLength(1)
    expect(continues()[0]?.text).toBe('continue')
  })

  test('the continue prompt comes from userConfig', { options: { prompt: 'pick up where you left off' } }, async ($, on) => {
    const { clock, continues } = world(on)
    await endTurn($, 'error')
    await clock.advance(10_000)
    expect(continues().map(p => p.text)).toEqual(['pick up where you left off'])
  })
})

describe('backoff', () => {
  test('goes up 10s, 30s, 60s and resets on a successful turn', async ($, on) => {
    const { clock, continues } = world(on)
    for (const [i, seconds] of [10, 30, 60].entries()) {
      await endTurn($, 'error')
      await clock.advance(seconds * 1000 - 1000)
      expect(continues()).toHaveLength(i)
      await clock.advance(1000)
      expect(continues()).toHaveLength(i + 1)
    }

    await endTurn($, 'answer')
    await clock.advance(2 * 60 * 60 * 1000)
    await endTurn($, 'error')
    await clock.advance(10_000)
    expect(continues()).toHaveLength(4)
  })
})

describe('lives', () => {
  test('3 continues per hour, then GAME OVER until the user prompts', async ($, on) => {
    const { clock, continues } = world(on)
    for (const seconds of [10, 30, 60]) {
      await endTurn($, 'error')
      await clock.advance(seconds * 1000)
    }
    expect(continues()).toHaveLength(3)

    await endTurn($, 'error')
    await clock.advance(600_000)
    expect(continues()).toHaveLength(3)
    const ui = await band($, 'terminal')
    expect((await ui.find({ key: 'title' }))?.text).toContain('GAME OVER')
    expect((await ui.find({ key: 'lives' }))?.text).toBe('♡♡♡')

    await typePrompt($, 'try again')
    expect(await ui.find({ key: 'title' })).toBeUndefined()

    await clock.advance(60 * 60 * 1000)
    await endTurn($, 'error')
    await clock.advance(10_000)
    expect(continues()).toHaveLength(4)
  })

  test('lives come from userConfig', { options: { lives: 1 } }, async ($, on) => {
    const { clock, continues } = world(on)
    await endTurn($, 'error')
    await clock.advance(10_000)
    await endTurn($, 'error')
    await clock.advance(600_000)
    expect(continues()).toHaveLength(1)
  })
})

describe('cancelling', () => {
  test('typing in the prompt box cancels and resets the backoff', async ($, on) => {
    const { clock, continues } = world(on)
    await endTurn($, 'error')
    await clock.advance(10_000)
    await endTurn($, 'error')
    await clock.advance(5_000)
    await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'w' })
    await clock.advance(600_000)
    expect(continues()).toHaveLength(1)

    await endTurn($, 'error')
    await clock.advance(10_000)
    expect(continues()).toHaveLength(2)
  })

  test('a typed prompt cancels', async ($, on) => {
    const { clock, continues } = world(on)
    await endTurn($, 'error')
    await typePrompt($, 'never mind, do this instead')
    await clock.advance(600_000)
    expect(continues()).toHaveLength(0)
  })

  test('respawn\'s own continue does not cancel the next countdown', async ($, on) => {
    const { clock, continues } = world(on)
    await endTurn($, 'error')
    await clock.advance(10_000)
    await endTurn($, 'error')
    await clock.advance(30_000)
    expect(continues()).toHaveLength(2)
  })

  test('/respawn off cancels and stays off until /respawn on', async ($, on) => {
    const { clock, continues } = world(on)
    await endTurn($, 'error')
    const off = await respawnCommand($, 'off')
    expect(off.text).toContain('OFF')
    await clock.advance(600_000)
    await endTurn($, 'error')
    await clock.advance(600_000)
    expect(continues()).toHaveLength(0)

    await respawnCommand($, 'on')
    await endTurn($, 'error')
    await clock.advance(10_000)
    expect(continues()).toHaveLength(1)
  })

  test('/respawn shows the state', async ($, on) => {
    const { clock } = world(on)
    expect((await respawnCommand($, '')).text).toContain('READY!')
    await endTurn($, 'error')
    await clock.advance(3_000)
    expect((await respawnCommand($, '')).text).toContain('CONTINUE? 7')
  })
})

describe('status line', () => {
  test('follows the countdown and clears when cancelled', async ($, on) => {
    const { clock, statuses } = world(on)
    await endTurn($, 'error')
    expect(statuses.at(-1)).toBe('RESPAWN CONTINUE? 10 ♥♥♥')
    await clock.advance(1_000)
    expect(statuses.at(-1)).toBe('RESPAWN CONTINUE? 9 ♥♥♥')
    await typePrompt($, 'stop')
    expect(statuses.at(-1)).toBeUndefined()
    expect(statuses.every(line => (line ?? '').length <= 40)).toBe(true)
  })
})

describe('band', () => {
  test('shows nothing while idle', async ($, on) => {
    world(on)
    for (const surface of SURFACES) {
      const ui = await band($, surface)
      expect(await ui.find({ key: 'title' })).toBeUndefined()
    }
  })

  for (const surface of SURFACES) {
    test(`counts down on ${surface} with a big digit and lives`, async ($, on) => {
      const { clock } = world(on)
      await endTurn($, 'error')
      const ui = await band($, surface)
      expect((await ui.find({ key: 'title' }))?.text).toContain('CONTINUE?')
      expect((await ui.find({ key: 'lives' }))?.text).toBe('♥♥♥')
      expect((await ui.find({ key: 'seconds' }))?.text).toBe('10')
      const digitRows = await ui.findAll({ key: 'digit-row' })
      expect(digitRows).toHaveLength(3)
      await clock.advance(4_000)
      expect((await ui.find({ key: 'seconds' }))?.text).toBe('6')
    })

    test(`[INSERT COIN] continues now on ${surface}`, async ($, on) => {
      const { continues } = world(on)
      await endTurn($, 'error')
      const ui = await band($, surface)
      await ui.press({ key: 'insert-coin' })
      expect(continues()).toHaveLength(1)
      expect(await ui.find({ key: 'title' })).toBeUndefined()
    })

    test(`[GAME OVER] cancels on ${surface}`, async ($, on) => {
      const { clock, continues } = world(on)
      await endTurn($, 'error')
      const ui = await band($, surface)
      await ui.press({ key: 'game-over' })
      await clock.advance(600_000)
      expect(continues()).toHaveLength(0)
      expect(await ui.find({ key: 'title' })).toBeUndefined()
    })
  }

  for (const surface of SURFACES) {
    test(`GAME OVER band shows a broken heart and [OK] dismisses it on ${surface}`, async ($, on) => {
      const { clock, continues } = world(on)
      for (const seconds of [10, 30, 60]) {
        await endTurn($, 'error')
        await clock.advance(seconds * 1000)
      }
      await endTurn($, 'error')
      const ui = await band($, surface)
      expect((await ui.find({ key: 'title' }))?.text).toContain('GAME OVER')
      expect(await ui.findAll({ key: 'digit-row' })).toHaveLength(3)
      expect(await ui.find({ key: 'insert-coin' })).toBeUndefined()
      await ui.press({ key: 'dismiss' })
      expect(await ui.find({ key: 'title' })).toBeUndefined()
      await clock.advance(600_000)
      expect(continues()).toHaveLength(3)
    })
  }

  test('yields to a survey', async ($, on) => {
    world(on)
    await endTurn($, 'error')
    const ui = await $.ui.mount({ plugin: 'respawn', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, hasSurvey: true } })
    expect(await ui.find({ key: 'title' })).toBeUndefined()
  })
})

describe('hardening', () => {
  const spendAllLives = async ($: Engine, clock: { advance: (ms: number) => Promise<void> }) => {
    for (const seconds of [10, 30, 60]) {
      await endTurn($, 'error')
      await clock.advance(seconds * 1000)
    }
    await endTurn($, 'error')
  }

  test('GAME OVER holds past the hour until the user prompts', async ($, on) => {
    const { clock, continues } = world(on)
    await spendAllLives($, clock)
    expect(continues()).toHaveLength(3)

    await clock.advance(60 * 60 * 1000)
    await $.prompt.submit({ text: 'nightly', origin: { kind: 'scheduled-trigger' }, wait: false } as never)
    await endTurn($, 'error')
    await clock.advance(600_000)
    expect(continues()).toHaveLength(3)
    const ui = await band($, 'terminal')
    expect((await ui.find({ key: 'title' }))?.text).toContain('GAME OVER')

    await typePrompt($, 'go on')
    await endTurn($, 'error')
    await clock.advance(10_000)
    expect(continues()).toHaveLength(4)
  })

  test('a successful turn the user did not send keeps GAME OVER', async ($, on) => {
    const { clock, continues } = world(on)
    await spendAllLives($, clock)
    await clock.advance(60 * 60 * 1000)
    await endTurn($, 'answer')
    await endTurn($, 'error')
    await clock.advance(600_000)
    expect(continues()).toHaveLength(3)
  })

  for (const surface of SURFACES) {
    test(`the GAME OVER band counts the minutes and the lives coming back on ${surface}`, async ($, on) => {
      const { clock, statuses } = world(on)
      await spendAllLives($, clock)
      const ui = await band($, surface)
      expect((await ui.find({ key: 'next-life' }))?.text).toBe('NEXT LIFE IN 59 MIN')
      await clock.advance(30 * 60 * 1000)
      expect((await ui.find({ key: 'next-life' }))?.text).toBe('NEXT LIFE IN 29 MIN')
      expect((await ui.find({ key: 'lives' }))?.text).toBe('♡♡♡')
      await clock.advance(30 * 60 * 1000)
      expect((await ui.find({ key: 'lives' }))?.text).not.toBe('♡♡♡')
      expect(statuses.at(-1)).not.toBe('RESPAWN GAME OVER ♡♡♡')
      expect((await ui.find({ key: 'title' }))?.text).toContain('GAME OVER')
    })
  }

  test('two INSERT COIN presses close together spend one life', async ($, on) => {
    const { continues } = world(on)
    await endTurn($, 'error')
    const ui = await band($, 'terminal')
    await Promise.all([ui.press({ key: 'insert-coin' }), ui.press({ key: 'insert-coin' })])
    expect(continues()).toHaveLength(1)
    expect((await respawnCommand($, '')).text).toContain('♥♥♡')
  })

  test('a reload re-arms a running countdown', async ($, on) => {
    // A hand-held clock whose waits a "reload" can drop, as a real reload cancels them.
    let now = 1_000_000
    let waits: { resolve: () => void; reject: (err: Error) => void }[] = []
    on('clock.now', () => ({ value: now }))
    on('clock.every', () => new Promise<{ value: undefined }>((resolve, reject) => {
      waits.push({ resolve: () => resolve({ value: undefined }), reject })
    }))
    const submitted: PromptSubmitInput[] = []
    on('prompt.submit', (_$, e) => {
      submitted.push(e)
      return { text: e.text }
    })
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    const statuses: (string | undefined)[] = []
    on('ui.status', (_$, e) => {
      statuses.push(e.text)
      return { value: undefined }
    })
    on('ui.toast', () => ({ value: undefined }))
    on('session.start', () => ({ cwd: '/work' }) as never)
    on('command.register', () => ({ value: undefined }) as never)
    const second = async () => {
      now += 1000
      const due = waits
      waits = []
      for (const w of due) w.resolve()
      await new Promise(r => setTimeout(r, 15))
    }

    await endTurn($, 'error')
    for (let i = 0; i < 3; i += 1) await second()
    expect(statuses.at(-1)).toBe('RESPAWN CONTINUE? 7 ♥♥♥')
    for (const w of waits) w.reject(new Error('reloaded'))
    waits = []
    now += 30_000
    expect(submitted).toHaveLength(0)

    await $.session.start({ cwd: '/work' } as never)
    expect(statuses.at(-1)).toBe('RESPAWN CONTINUE? 0 ♥♥♥')
    await second()
    await new Promise(r => setTimeout(r, 20))
    expect(submitted.filter(p => p.origin.kind === 'plugin')).toHaveLength(1)
  })
})
