import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'

import { PALETTE } from '../hooks/pixels'
import { DEFAULT_DIR, PANE_PROPS, START, STARTER, SURFACES, world } from './world'

const PICO8 = new Set<string>(Object.values(PALETTE))

/** Every colour drawn is PICO-8, and no glyph is double width. */
const expectPaletteOnly = (tree: unknown) => {
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      expect(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(node)).toBe(false)
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

const mountPane = ($: EngineInterface, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'radar', surface, component: 'Pane', requestId: 'radar', props: PANE_PROPS })

describe('RADAR pane', () => {
  for (const surface of SURFACES) {
    test(`shows the sweep, the memory count and the recent pings on ${surface}`, async ($, on) => {
      world(on)
      await $.session.start(START)
      await $.turn.start({ text: 'go', turnId: 't1' })
      await $.tool.call({ tool: 'Bash', command: 'git checkout -- a.ts' })
      await $.tool.call({ tool: 'Bash', command: 'docker compose up' })
      const ui = await mountPane($, surface)

      const header = await ui.find({ type: 'Text', text: 'RADAR · 3 MEMORIES' })
      expect(header?.props.color).toBe(PALETTE.v)
      expect(await ui.find({ type: 'Text', text: '2 PINGS THIS SESSION' })).toBeDefined()
      const rows = await ui.findAll({ type: 'Text', text: /^\d\d:\d\d {2}BASH {2}/ })
      expect(rows.map(row => row.props.children ?? row)).toHaveLength(2)
      expect(await ui.find({ type: 'Text', text: /Docker stack capacity/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Never checkout a dirty file/ })).toBeDefined()
      const pixels = await ui.findAll({ type: 'Text', text: /[▀▄]/ })
      expect(pixels.some(cell => cell.props.color === PALETTE.v || cell.props.backgroundColor === PALETTE.v)).toBe(true)
      expect(pixels.some(cell => cell.props.color === PALETTE.i || cell.props.backgroundColor === PALETTE.i)).toBe(true)
      expectPaletteOnly(await ui.drawn())
    })

    test(`with no pings yet it says the scope is quiet, on ${surface}`, async ($, on) => {
      world(on)
      await $.session.start(START)
      const ui = await mountPane($, surface)
      expect(await ui.find({ type: 'Text', text: /NO PINGS YET/ })).toBeDefined()
      expectPaletteOnly(await ui.drawn())
    })

    test(`lists skipped files and the folders read, on ${surface}`, async ($, on) => {
      world(on, { ...STARTER, [`${DEFAULT_DIR}/broken.md`]: '---\nname: n\n' })
      await $.session.start(START)
      const ui = await mountPane($, surface)
      expect(await ui.find({ type: 'Text', text: 'SKIPPED: 1' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /broken\.md.*not closed/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: new RegExp(DEFAULT_DIR) })).toBeDefined()
    })

    test(`RELOAD re-reads the folders, on ${surface}`, async ($, on) => {
      const w = world(on)
      await $.session.start(START)
      const ui = await mountPane($, surface)
      w.files[`${DEFAULT_DIR}/new.md`] = '---\nname: New one\ndescription: fresh\n---\n'
      await ui.press({ key: 'radar-reload' })
      expect(await ui.find({ type: 'Text', text: 'RADAR · 4 MEMORIES' })).toBeDefined()
    })
  }
})
