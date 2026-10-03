import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PICO8 } from '../hooks/sprite'
import {
  BAND_PROPS,
  FORCE_RULE,
  NOTE_RULE,
  PANE_PROPS,
  START,
  SURFACES,
  USER_FILE,
  ruleFile,
  run,
  world,
} from './world'

const PALETTE = new Set<string>(Object.values(PICO8))
const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const PROPOSED = {
  id: 'no-friday-deploy',
  tool: 'Bash',
  match: '\\bdeploy\\b',
  field: 'command',
  action: 'deny',
  message: 'No deploys on a Friday.',
}

const answerModel = (on: On, text: string) =>
  on('model.complete', () => ({ value: { isAnswered: true, text, usage: USAGE } }))

/** Every colour drawn is PICO-8, and no glyph is double width. */
const expectEightBit = (tree: unknown) => {
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      expect(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(node)).toBe(false)
      return
    }
    if (typeof node !== 'object' || node === null) return
    const element = node as { props?: Record<string, unknown>; children?: unknown[] }
    for (const key of ['color', 'backgroundColor', 'borderColor']) {
      const value = element.props?.[key]
      if (value !== undefined) expect(PALETTE.has(String(value))).toBe(true)
    }
    for (const child of element.children ?? []) walk(child)
  }
  walk(tree)
}

describe('TRAPS ARMED pane', () => {
  for (const surface of SURFACES) {
    test(`shows each rule's id, action, hit count and last hit on ${surface}`, async ($, on) => {
      world(on, { [USER_FILE]: ruleFile(FORCE_RULE, NOTE_RULE) }, { hits: { 'no-force-push': { count: 4, lastHit: Date.UTC(2026, 9, 3, 9, 30) } } })
      await $.session.start(START)
      const ui = await $.ui.mount({ plugin: 'tripwire', surface, component: 'Pane', requestId: 'tripwire', props: PANE_PROPS })

      const header = await ui.find({ type: 'Text', text: 'TRAPS ARMED: 2' })
      expect(header?.props.color).toBe(PICO8.r)
      expect(await ui.find({ type: 'Text', text: /NO-FORCE-PUSH/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /CHECKS-AFTER-PUSH/ })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: /^DENY/ }))?.props.color).toBe(PICO8.r)
      expect((await ui.find({ type: 'Text', text: /^NOTE/ }))?.props.color).toBe(PICO8.y)
      expect(await ui.find({ type: 'Text', text: /x4/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^\d\d:\d\d$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '--:--' })).toBeDefined()
      expect(await ui.findAll({ type: 'Button', text: 'DISARM' })).toHaveLength(2)
      expectEightBit(await ui.drawn())
    })

    test(`Disarm toggles a rule off for the session and back on, on ${surface}`, async ($, on) => {
      const w = world(on, { [USER_FILE]: ruleFile(FORCE_RULE, NOTE_RULE) })
      await $.session.start(START)
      const ui = await $.ui.mount({ plugin: 'tripwire', surface, component: 'Pane', requestId: 'tripwire', props: PANE_PROPS })

      await ui.press({ key: 'disarm-no-force-push' })
      expect(w.opened.at(-1)?.title).toBe('TRAPS ARMED: 1')
      expect((await ui.find({ key: 'disarm-no-force-push' }))?.props.label).toBe('REARM')
      expect(await ui.find({ type: 'Text', text: 'TRAPS ARMED: 1' })).toBeDefined()
      const passed = await $.tool.call({ tool: 'Bash', command: 'git push --force' })
      expect(passed.deny).toBeUndefined()
      expect(w.files[USER_FILE]).toBe(ruleFile(FORCE_RULE, NOTE_RULE))

      await ui.press({ key: 'disarm-no-force-push' })
      expect(w.opened.at(-1)?.title).toBe('TRAPS ARMED: 2')
      const denied = await $.tool.call({ tool: 'Bash', command: 'git push --force' })
      expect(denied.deny).toContain('TRAP SPRUNG')
    })

    test(`lists bad rules that were skipped on ${surface}`, async ($, on) => {
      world(on, { [USER_FILE]: ruleFile(FORCE_RULE, { ...NOTE_RULE, match: '(' }) })
      await $.session.start(START)
      const ui = await $.ui.mount({ plugin: 'tripwire', surface, component: 'Pane', requestId: 'tripwire', props: PANE_PROPS })
      expect(await ui.find({ type: 'Text', text: 'BAD RULES SKIPPED: 1' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /checks-after-push.*bad regex/ })).toBeDefined()
    })

    test(`an empty rule set says how to start on ${surface}`, async ($, on) => {
      world(on)
      await $.session.start(START)
      const ui = await $.ui.mount({ plugin: 'tripwire', surface, component: 'Pane', requestId: 'tripwire', props: PANE_PROPS })
      expect(await ui.find({ type: 'Text', text: /tripwire init/ })).toBeDefined()
    })
  }
})

describe('/tripwire add: the human arms', () => {
  for (const surface of SURFACES) {
    test(`ARM appends the proposal to the user file and arms it on ${surface}`, async ($, on) => {
      const w = world(on, { [USER_FILE]: ruleFile(FORCE_RULE) })
      answerModel(on, JSON.stringify(PROPOSED))
      await $.session.start(START)
      await $.command.run(run('add never deploy on a friday'))
      const ui = await $.ui.mount({ plugin: 'tripwire', surface, component: 'Pane', requestId: 'tripwire', props: PANE_PROPS })

      expect(await ui.find({ type: 'Text', text: /PROPOSED RULE/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /no-friday-deploy/ })).toBeDefined()
      expect(w.writes).toHaveLength(0)
      const before = await $.tool.call({ tool: 'Bash', command: './deploy prod' })
      expect(before.deny).toBeUndefined()

      await ui.press({ key: 'tripwire-arm' })
      expect(w.writes).toHaveLength(1)
      expect(w.writes[0]?.path).toBe(USER_FILE)
      expect(JSON.parse(w.writes[0]?.text ?? '{}').rules.map((rule: { id: string }) => rule.id)).toEqual([
        'no-force-push',
        'no-friday-deploy',
      ])
      expect(await ui.find({ type: 'Text', text: 'TRAPS ARMED: 2' })).toBeDefined()
      expect(await ui.find({ key: 'tripwire-arm' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /ARMED no-friday-deploy/ })).toBeDefined()
      const after = await $.tool.call({ tool: 'Bash', command: './deploy prod' })
      expect(after.deny).toContain('no-friday-deploy')
    })

    test(`DISCARD writes nothing on ${surface}`, async ($, on) => {
      const w = world(on, { [USER_FILE]: ruleFile(FORCE_RULE) })
      answerModel(on, JSON.stringify(PROPOSED))
      await $.session.start(START)
      await $.command.run(run('add never deploy on a friday'))
      const ui = await $.ui.mount({ plugin: 'tripwire', surface, component: 'Pane', requestId: 'tripwire', props: PANE_PROPS })
      await ui.press({ key: 'tripwire-discard' })
      expect(w.writes).toHaveLength(0)
      expect(await ui.find({ key: 'tripwire-arm' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /DISCARDED/ })).toBeDefined()
    })

    test(`an unparseable proposal shows the reason and no ARM on ${surface}`, async ($, on) => {
      const w = world(on)
      answerModel(on, JSON.stringify({ ...PROPOSED, action: 'explode' }))
      await $.session.start(START)
      await $.command.run(run('add do something'))
      const ui = await $.ui.mount({ plugin: 'tripwire', surface, component: 'Pane', requestId: 'tripwire', props: PANE_PROPS })
      expect(await ui.find({ type: 'Text', text: /COULD NOT COMPILE/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /unknown action "explode"/ })).toBeDefined()
      expect(await ui.find({ key: 'tripwire-arm' })).toBeUndefined()
      expect(w.writes).toHaveLength(0)
    })

    test(`ARM never clobbers a user file that is not a rule list, on ${surface}`, async ($, on) => {
      const w = world(on, { [USER_FILE]: '{ "oops": true }' })
      answerModel(on, JSON.stringify(PROPOSED))
      await $.session.start(START)
      await $.command.run(run('add never deploy on a friday'))
      const ui = await $.ui.mount({ plugin: 'tripwire', surface, component: 'Pane', requestId: 'tripwire', props: PANE_PROPS })
      await ui.press({ key: 'tripwire-arm' })
      expect(w.writes).toHaveLength(0)
      expect(await ui.find({ type: 'Text', text: /not a rule list/ })).toBeDefined()
    })
  }
})

describe('TRAP SPRUNG band', () => {
  for (const surface of SURFACES) {
    test(`draws the red pixel-art trap with id, message and cite after a deny on ${surface}`, async ($, on) => {
      world(on, { [USER_FILE]: ruleFile(FORCE_RULE) })
      await $.session.start(START)
      await $.tool.call({ tool: 'Bash', command: 'git push --force' })
      const band = await $.ui.mount({ plugin: 'tripwire', surface, component: 'AbovePrompt', props: BAND_PROPS })

      const label = await band.find({ type: 'Text', text: /TRAP SPRUNG!/ })
      expect(label?.props.backgroundColor).toBe(PICO8.r)
      expect(await band.find({ type: 'Text', text: 'NO-FORCE-PUSH' })).toBeDefined()
      expect(await band.find({ type: 'Text', text: 'Force pushes rewrite shared history.' })).toBeDefined()
      expect(await band.find({ type: 'Text', text: 'CITE memory/never-force-push.md' })).toBeDefined()
      const pixels = await band.findAll({ type: 'Text', text: /[▀▄]/ })
      expect(pixels.some(cell => cell.props.color === PICO8.r)).toBe(true)
      expectEightBit(await band.drawn())
    })

    test(`stays away until something is sprung, and OK clears it, on ${surface}`, async ($, on) => {
      world(on, { [USER_FILE]: ruleFile(FORCE_RULE) })
      on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
        const { Text } = $.ui.resolve(e)
        return h(Text, {}, 'ENGINE BAND')
      })
      await $.session.start(START)
      const band = await $.ui.mount({ plugin: 'tripwire', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect(await band.find({ type: 'Text', text: 'ENGINE BAND' })).toBeDefined()

      await $.tool.call({ tool: 'Bash', command: 'git push --force' })
      await band.redraw()
      expect(await band.find({ type: 'Text', text: /TRAP SPRUNG!/ })).toBeDefined()

      await band.press({ key: 'tripwire-ok' })
      expect(await band.find({ type: 'Text', text: /TRAP SPRUNG!/ })).toBeUndefined()
      expect(await band.find({ type: 'Text', text: 'ENGINE BAND' })).toBeDefined()
    })
  }

  test('with the band off, a deny toasts instead', { options: { band: false } }, async ($, on) => {
    const w = world(on, { [USER_FILE]: ruleFile(FORCE_RULE) })
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, 'ENGINE BAND')
    })
    await $.session.start(START)
    await $.tool.call({ tool: 'Bash', command: 'git push --force' })
    expect(w.toasts).toContain('TRAP SPRUNG! no-force-push')
    const band = await $.ui.mount({ plugin: 'tripwire', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ type: 'Text', text: /TRAP SPRUNG!/ })).toBeUndefined()
  })
})
