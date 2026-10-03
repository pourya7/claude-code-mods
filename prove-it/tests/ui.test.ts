import { describe, expect, test } from 'claude-code/testing'

import { PALETTE } from '../hooks/pixels'
import { ROOT, makeRepo } from './repo'
import { BAND_PROPS, NO_GATE, START, SURFACES, prove, world } from './world'

const PICO8 = new Set<string>(Object.values(PALETTE))
/** Only these non-ASCII glyphs are drawn; all are single width. */
const ALLOWED = /^[\x20-\x7E▀▄█▶▸★◆●·×…]*$/u

/** Every colour drawn is PICO-8, and every glyph is single width. */
const expectPixelArt = (tree: unknown) => {
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      expect(ALLOWED.test(node)).toBe(true)
      return
    }
    if (typeof node !== 'object' || node === null) return
    const element = node as { props?: Record<string, unknown>; children?: unknown[] }
    for (const key of ['color', 'backgroundColor', 'borderColor']) {
      const value = element.props?.[key]
      if (value !== undefined) expect(PICO8.has(String(value))).toBe(true)
    }
    for (const child of element.children ?? []) walk(child)
  }
  walk(tree)
}

describe('verdict band', () => {
  for (const surface of SURFACES) {
    test(`nothing to say before the first proof on ${surface}`, NO_GATE, async ($, on) => {
      world(on)
      await $.session.start(START)
      const ui = await $.ui.mount({ plugin: 'prove-it', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect(await ui.find({ key: 'title' })).toBeUndefined()
    })

    test(`PROVEN ★ in lime, both runs and the counts on ${surface}`, NO_GATE, async ($, on) => {
      world(on)
      await $.session.start(START)
      await $.command.run(prove())
      const ui = await $.ui.mount({ plugin: 'prove-it', surface, component: 'AbovePrompt', props: BAND_PROPS })
      const title = await ui.find({ key: 'title' })
      expect(title?.text).toBe('▶ PROVEN ★')
      expect((await ui.find({ type: 'Text', text: '▶ PROVEN ★' }))?.props.color).toBe(PALETTE.i)
      expect((await ui.find({ key: 'without' }))?.text).toBe('WITHOUT THE FIX × FAIL 1')
      expect((await ui.find({ key: 'with' }))?.text).toBe('WITH THE FIX    ★ PASS')
      expect(await ui.find({ type: 'Text', text: '1 SOURCE · 1 TEST · BASE b4se000' })).toBeDefined()
      expectPixelArt(await ui.drawn())
    })

    test(`NOT PROVEN in red on ${surface}`, NO_GATE, async ($, on) => {
      world(on, makeRepo({ judge: () => 0 }))
      await $.session.start(START)
      await $.command.run(prove())
      const ui = await $.ui.mount({ plugin: 'prove-it', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect((await ui.find({ key: 'title' }))?.text).toBe('▶ NOT PROVEN')
      expect((await ui.find({ type: 'Text', text: '▶ NOT PROVEN' }))?.props.color).toBe(PALETTE.r)
      expect((await ui.find({ key: 'without' }))?.text).toBe('WITHOUT THE FIX ★ PASS')
      expectPixelArt(await ui.drawn())
    })

    test(`BROKEN in red on ${surface}`, NO_GATE, async ($, on) => {
      world(on, makeRepo({ judge: () => 1 }))
      await $.session.start(START)
      await $.command.run(prove())
      const ui = await $.ui.mount({ plugin: 'prove-it', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect((await ui.find({ key: 'title' }))?.text).toBe('▶ BROKEN')
      expectPixelArt(await ui.drawn())
    })

    test(`OK hides the band until the next proof on ${surface}`, NO_GATE, async ($, on) => {
      world(on)
      await $.session.start(START)
      await $.command.run(prove())
      const ui = await $.ui.mount({ plugin: 'prove-it', surface, component: 'AbovePrompt', props: BAND_PROPS })
      await ui.press({ key: 'ok' })
      expect(await ui.find({ key: 'title' })).toBeUndefined()
      await $.command.run(prove())
      expect((await ui.find({ key: 'title' }))?.text).toBe('▶ PROVEN ★')
    })

    test(`AGAIN runs the proof again on ${surface}`, NO_GATE, async ($, on) => {
      const w = world(on, makeRepo({ judge: () => 0 }))
      await $.session.start(START)
      await $.command.run(prove())
      const ui = await $.ui.mount({ plugin: 'prove-it', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect((await ui.find({ key: 'title' }))?.text).toBe('▶ NOT PROVEN')
      w.repo.judge = files => (files.get(`${ROOT}/src/add.ts`)?.includes('a + b') ? 0 : 1)
      await ui.press({ key: 'again' })
      expect(w.repo.testRuns).toBe(4)
      expect((await ui.find({ key: 'title' }))?.text).toBe('▶ PROVEN ★')
    })

    test(`PROVING... while the tests run, then the verdict, on ${surface}`, NO_GATE, async ($, on) => {
      const w = world(on)
      let release: () => void = () => undefined
      w.hold = new Promise(resolve => {
        release = resolve
      })
      await $.session.start(START)
      const ui = await $.ui.mount({ plugin: 'prove-it', surface, component: 'AbovePrompt', props: BAND_PROPS })
      const running = $.command.run(prove())
      for (let i = 0; i < 50 && !w.statuses.includes('PROVE-IT ▸ PROVING 1/2'); i += 1) await Promise.resolve()
      expect((await ui.find({ key: 'title' }))?.text).toBe('▶ PROVING...')
      expect(await ui.find({ key: 'ok' })).toBeUndefined()
      expectPixelArt(await ui.drawn())
      release()
      await running
      expect((await ui.find({ key: 'title' }))?.text).toBe('▶ PROVEN ★')
    })

    test(`a second /prove while one runs is refused and leaves the first one's result on ${surface}`, NO_GATE, async ($, on) => {
      const w = world(on)
      let release: () => void = () => undefined
      w.hold = new Promise(resolve => {
        release = resolve
      })
      await $.session.start(START)
      const first = $.command.run(prove())
      for (let i = 0; i < 50 && !w.statuses.includes('PROVE-IT ▸ PROVING 1/2'); i += 1) await Promise.resolve()
      const second = await $.command.run(prove())
      expect(second.text).toContain('already running')
      release()
      expect((await first).text).toContain('PROVEN ★')
      expect(w.repo.testRuns).toBe(2)
      const ui = await $.ui.mount({ plugin: 'prove-it', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect((await ui.find({ key: 'title' }))?.text).toBe('▶ PROVEN ★')
    })

    test(`stays out of subagent views on ${surface}`, NO_GATE, async ($, on) => {
      world(on)
      await $.session.start(START)
      await $.command.run(prove())
      const ui = await $.ui.mount({
        plugin: 'prove-it',
        surface,
        component: 'AbovePrompt',
        props: { ...BAND_PROPS, view: { agentId: 'sub-1' } },
      })
      expect(await ui.find({ key: 'title' })).toBeUndefined()
    })
  }
})
