import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionCompactTrigger } from 'claude-code'

const PLUGIN = 'quicksave'
const SURFACES = ['terminal', 'desktop'] as const
const SESSION = 'sess-1'
const CWD = '/work/app'
const START = { cwd: CWD, surface: 'terminal', isInteractive: true } as const
const PRESENTATION = { isFullscreen: false, columns: 100 }
const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const bandProps = (isWorking = false) => ({
  hasSurvey: false,
  isWorking,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
})

const SAVE = {
  goal: 'Ship the retry fix for the uploader',
  step: 'Writing the regression test',
  cwd: '~/work/app',
  branch: 'fix/upload-retry',
  links: ['PR #42'],
  decisions: ['Retry 3 times with jitter'],
  rules: ['No force push'],
  next: 'Run the test suite',
}

type Fork = { isAnswered: true; text: string } | { isAnswered: false; reason: string }

/** The engine beneath quicksave: a forkable model, a store, files, a compactor that records what it got. */
const world = (on: On) => {
  const state = {
    log: [] as string[],
    forkPrompts: [] as string[],
    fork: { isAnswered: true, text: JSON.stringify(SAVE) } as Fork,
    store: {} as Record<string, unknown>,
    writes: [] as { path: string; text: string }[],
    toasts: [] as string[],
    commands: [] as string[],
    compactInstructions: [] as (string | undefined)[],
    agents: [] as { id: string; status: string }[],
    saveCount: 0,
    /** What core's compactor keeps after its summary. */
    kept: [] as { role: 'user' | 'assistant'; text: string; toolUses: never[] }[],
    /** When set, a fork waits for it, so a test can act while a save is in flight. */
    gate: undefined as Promise<void> | undefined,
  }
  mock.clock(on, { now: Date.UTC(2026, 9, 3, 12, 4) })
  on('store.get', ($, e) => ({ value: state.store[e.key] }))
  on('store.set', ($, e) => {
    state.store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    delete state.store[e.key]
    return { value: undefined }
  })
  on('model.fork', async ($, e) => {
    state.log.push('fork')
    if (state.gate !== undefined) await state.gate
    state.forkPrompts.push(e.prompt)
    const fork = state.fork
    state.saveCount += 1
    const value = fork.isAnswered
      ? { isAnswered: true, text: fork.text.replace('Ship', `Ship #${state.saveCount}`), usage: USAGE }
      : { isAnswered: false, reason: fork.reason, usage: USAGE }
    return { value } as never
  })
  on('session.id', () => ({ value: SESSION }) as never)
  on('session.cwd', () => ({ value: CWD }) as never)
  on('agent.list', () => ({ value: state.agents }) as never)
  on('fs.write', ($, e) => {
    state.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('command.register', ($, e) => {
    state.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.compact', ($, e) => {
    state.log.push('compact')
    state.compactInstructions.push(e.instructions)
    return { messages: [{ role: 'user', text: 'SUMMARY OF EARLIER WORK', toolUses: [] }, ...state.kept] } as never
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
  return state
}

const compact = ($: Engine, trigger: SessionCompactTrigger, agentId?: string) =>
  $.session.compact({
    trigger,
    messages: [{ role: 'user', text: 'fix the uploader', toolUses: [] }],
    ...(agentId ? { agentId } : {}),
  } as never)

const command = ($: Engine, name: string, args = '') =>
  $.command.run({ command: name, args, origin: { kind: 'composer' }, presentation: PRESENTATION } as never)

const measure = ($: Engine, percent: number) =>
  $.session.measure({
    context: { window: 200_000, tokens: percent * 2_000, percent },
    rateLimits: [],
    changed: ['context'],
  } as never)

const slotsIn = (store: Record<string, unknown>) => (store[`slots/${SESSION}`] ?? []) as { save: { goal: string } }[]

const band = ($: Engine, surface: (typeof SURFACES)[number], isWorking = false) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(isWorking) })

describe('commands', () => {
  test('session.start registers /quicksave and /quickload', async ($, on) => {
    const state = world(on)
    await $.session.start(START as never)
    expect(state.commands).toEqual(['quicksave', 'quickload'])
  })
})

describe('compaction', () => {
  for (const trigger of ['manual', 'auto', 'plugin'] as const) {
    test(`compaction (${trigger}) saves first, then re-injects the save`, async ($, on) => {
      const state = world(on)
      const result = (await compact($, trigger)) as { messages: { role: string; text: string }[] }

      expect(state.log).toEqual(['fork', 'compact'])
      expect(state.forkPrompts[0]).toContain('"goal"')
      expect(slotsIn(state.store).map(s => s.save.goal)).toEqual(['Ship #1 the retry fix for the uploader'])

      expect(result.messages).toHaveLength(2)
      expect(result.messages[0]?.text).toBe('SUMMARY OF EARLIER WORK')
      const note = result.messages[1]
      expect(note?.role).toBe('user')
      expect(note?.text).toContain('QUICKSAVE')
      expect(note?.text).toContain('GOAL: Ship #1 the retry fix for the uploader')
      expect(note?.text).toContain('NEXT STEP: Run the test suite')
      expect(state.toasts.some(t => t.includes('QUICKSAVE ★ SLOT 1'))).toBe(true)
    })
  }

  test('an older save note the compaction kept is replaced by the fresh one', async ($, on) => {
    const state = world(on)
    state.kept = [
      {
        role: 'user',
        text: 'QUICKSAVE (slot 3, saved 2026-10-01 09:00 UTC, auto). This is the save point...\nGOAL: stale old goal',
        toolUses: [],
      },
      { role: 'user', text: 'QUICKSAVE did not run last time?', toolUses: [] },
    ]
    const result = (await compact($, 'auto')) as { messages: { role: string; text: string }[] }
    const texts = result.messages.map(m => m.text)
    expect(texts.some(t => t.includes('stale old goal'))).toBe(false)
    expect(texts).toContain('QUICKSAVE did not run last time?')
    expect(texts[texts.length - 1]).toContain('GOAL: Ship #1 the retry fix for the uploader')
    expect(texts.filter(t => t.startsWith('QUICKSAVE (slot'))).toHaveLength(1)
  })

  test('a precompute and a subagent compaction pass through untouched', async ($, on) => {
    const state = world(on)
    const ahead = (await compact($, 'precompute')) as { messages: unknown[] }
    const sub = (await compact($, 'auto', 'agent-1')) as { messages: unknown[] }
    expect(state.log).toEqual(['compact', 'compact'])
    expect(ahead.messages).toHaveLength(1)
    expect(sub.messages).toHaveLength(1)
    expect(slotsIn(state.store)).toHaveLength(0)
  })

  for (const reason of ['api-error', 'nothing-to-fork', 'empty-reply'] as const) {
    test(`a fork that fails (${reason}) does not block compaction`, async ($, on) => {
      const state = world(on)
      state.fork = { isAnswered: false, reason }
      const result = (await compact($, 'auto')) as { messages: { text: string }[] }

      expect(state.log).toEqual(['fork', 'compact'])
      expect(result.messages.map(m => m.text)).toEqual(['SUMMARY OF EARLIER WORK'])
      expect(slotsIn(state.store)).toHaveLength(0)
      expect(state.toasts.some(t => t.includes('SAVE FAILED'))).toBe(true)
    })
  }

  test('slots are capped at 5, newest first', async ($, on) => {
    const state = world(on)
    for (let i = 0; i < 7; i += 1) await compact($, 'auto')
    const goals = slotsIn(state.store).map(s => s.save.goal)
    expect(goals).toHaveLength(5)
    expect(goals[0]).toContain('#7')
    expect(goals[4]).toContain('#3')
  })

  test('slots are kept for the 20 most recent sessions only', async ($, on) => {
    const state = world(on)
    const old = Array.from({ length: 20 }, (_, i) => `old-${i}`)
    state.store.sessions = old
    for (const id of old) state.store[`slots/${id}`] = []
    await compact($, 'auto')
    expect(state.store.sessions).toEqual([SESSION, ...old.slice(0, 19)])
    expect(state.store['slots/old-19']).toBeUndefined()
    expect(state.store['slots/old-18']).toEqual([])
  })

  test('no file is written while writeFile is off', async ($, on) => {
    const state = world(on)
    await compact($, 'manual')
    expect(state.writes).toHaveLength(0)
  })

  test('writeFile mirrors the save to the session cwd', { options: { writeFile: true } }, async ($, on) => {
    const state = world(on)
    await compact($, 'manual')
    expect(state.writes.map(w => w.path)).toEqual([`${CWD}/.claude/quicksave/${SESSION}.md`])
    expect(state.writes[0]?.text).toContain('## Goal')
    expect(state.writes[0]?.text).toContain('Ship #1 the retry fix for the uploader')
  })
})

describe('/quicksave and /quickload', () => {
  test('/quicksave saves now without compacting', async ($, on) => {
    const state = world(on)
    const reply = await command($, 'quicksave')
    expect(state.log).toEqual(['fork'])
    expect(reply.text).toContain('SLOT 1')
    expect(slotsIn(state.store)).toHaveLength(1)
  })

  test('/quicksave reports a failed fork', async ($, on) => {
    const state = world(on)
    state.fork = { isAnswered: false, reason: 'api-error' }
    const reply = await command($, 'quicksave')
    expect(reply.text).toContain('SAVE FAILED')
    expect(slotsIn(state.store)).toHaveLength(0)
  })

  test('/quicksave list shows the slots', async ($, on) => {
    world(on)
    expect((await command($, 'quicksave', 'list')).text).toContain('NO SAVES YET')
    await command($, 'quicksave')
    await command($, 'quicksave')
    const text = (await command($, 'quicksave', 'list')).text ?? ''
    expect(text).toContain('1 ★')
    expect(text).toContain('Ship #2')
    expect(text).toContain('2 ●')
    expect(text).toContain('Ship #1')
  })

  test('/quickload re-injects the newest save for the model', async ($, on) => {
    world(on)
    await command($, 'quicksave')
    await command($, 'quicksave')
    const reply = await command($, 'quickload')
    expect(reply.text).toContain('LOADED SLOT 1')
    expect(reply.context).toHaveLength(1)
    expect(reply.context?.[0]).toContain('GOAL: Ship #2 the retry fix for the uploader')
  })

  test('/quickload 2 picks an older slot', async ($, on) => {
    world(on)
    await command($, 'quicksave')
    await command($, 'quicksave')
    const reply = await command($, 'quickload', '2')
    expect(reply.context?.[0]).toContain('GOAL: Ship #1 the retry fix for the uploader')
  })

  test('/quickload with nothing saved injects nothing', async ($, on) => {
    world(on)
    const reply = await command($, 'quickload', '3')
    expect(reply.text).toContain('NO SAVE IN SLOT 3')
    expect(reply.context).toBeUndefined()
  })
})

describe('save-point band', () => {
  for (const surface of SURFACES) {
    test(`shows on ${surface} when idle above the threshold`, async ($, on) => {
      world(on)
      await measure($, 75)
      const ui = await band($, surface)
      expect((await ui.find({ key: 'title' }))?.text).toContain('SAVE POINT ▸ safe to /compact')
      expect(await ui.find({ key: 'save' })).toBeDefined()
      expect(await ui.find({ key: 'save-compact' })).toBeDefined()
      expect(await ui.findAll({ key: 'floppy-row' })).toHaveLength(4)
    })

    test(`stays hidden on ${surface} while a turn runs`, async ($, on) => {
      world(on)
      await measure($, 90)
      const ui = await band($, surface, true)
      expect(await ui.find({ key: 'title' })).toBeUndefined()
    })

    test(`stays hidden on ${surface} below the threshold`, async ($, on) => {
      world(on)
      await measure($, 69)
      const ui = await band($, surface)
      expect(await ui.find({ key: 'title' })).toBeUndefined()
    })

    test(`stays hidden on ${surface} while a background agent runs`, async ($, on) => {
      const state = world(on)
      state.agents = [{ id: 'a1', status: 'running' }]
      await measure($, 90)
      const ui = await band($, surface)
      expect(await ui.find({ key: 'title' })).toBeUndefined()
    })

    test(`[ SAVE ] on ${surface} saves a slot`, async ($, on) => {
      const state = world(on)
      await measure($, 80)
      const ui = await band($, surface)
      await ui.press({ key: 'save' })
      expect(state.log).toEqual(['fork'])
      expect(slotsIn(state.store)).toHaveLength(1)
      expect((await ui.find({ key: 'saved' }))?.text).toContain('SLOT 1')
    })

    test(`[ SAVE + COMPACT ] on ${surface} saves, then compacts keeping the save`, async ($, on) => {
      const state = world(on)
      await measure($, 80)
      const ui = await band($, surface)
      await ui.press({ key: 'save-compact' })
      expect(state.log).toEqual(['fork', 'compact'])
      expect(slotsIn(state.store)).toHaveLength(1)
      expect(state.compactInstructions[0]).toContain('GOAL: Ship #1 the retry fix for the uploader')
      expect(await ui.find({ key: 'title' })).toBeUndefined()
    })
  }

  test('pressing [ SAVE ] twice takes one save, not two racing forks', async ($, on) => {
    const state = world(on)
    await measure($, 80)
    const ui = await band($, 'terminal')
    await Promise.all([ui.press({ key: 'save' }), ui.press({ key: 'save' })])
    expect(state.log).toEqual(['fork'])
    expect(slotsIn(state.store)).toHaveLength(1)
    expect(state.toasts.filter(t => t.includes('SLOT 1 SAVED'))).toHaveLength(1)
  })

  test('pressing [ SAVE + COMPACT ] twice forks once and compacts once', async ($, on) => {
    const state = world(on)
    await measure($, 80)
    const ui = await band($, 'terminal')
    await Promise.all([ui.press({ key: 'save-compact' }), ui.press({ key: 'save-compact' })])
    expect(state.log).toEqual(['fork', 'compact'])
    expect(slotsIn(state.store)).toHaveLength(1)
  })

  test('/quicksave and a compaction during a band save join it instead of forking again', async ($, on) => {
    const state = world(on)
    let open = (): void => undefined
    state.gate = new Promise<void>(resolve => {
      open = resolve
    })
    await measure($, 80)
    const ui = await band($, 'terminal')
    const pressed = ui.press({ key: 'save' })
    await Promise.resolve()
    expect((await ui.find({ key: 'saving' }))?.text).toContain('SAVING')
    const reply = command($, 'quicksave')
    const compacted = compact($, 'auto') as Promise<{ messages: { text: string }[] }>
    open()
    await pressed
    expect((await reply).text).toContain('SAVED TO SLOT 1')
    const messages = (await compacted).messages
    expect(messages[messages.length - 1]?.text).toContain('GOAL: Ship #1 the retry fix for the uploader')
    expect(state.log).toEqual(['fork', 'compact'])
    expect(slotsIn(state.store)).toHaveLength(1)
  })

  test('the threshold comes from userConfig', { options: { warnAtPercent: 90 } }, async ($, on) => {
    world(on)
    await measure($, 85)
    const ui = await band($, 'terminal')
    expect(await ui.find({ key: 'title' })).toBeUndefined()
    await measure($, 92)
    expect((await ui.find({ key: 'title' }))?.text).toContain('SAVE POINT')
  })

  test('a compaction hides the band until the next measurement', async ($, on) => {
    world(on)
    await measure($, 80)
    const ui = await band($, 'terminal')
    expect(await ui.find({ key: 'title' })).toBeDefined()
    await compact($, 'manual')
    expect(await ui.find({ key: 'title' })).toBeUndefined()
  })
})
