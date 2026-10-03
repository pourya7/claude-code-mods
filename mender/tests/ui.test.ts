import { describe, expect, test } from 'claude-code/testing'

import { PICO8 } from '../hooks/pixels'
import { PANE_PROPS, SCHEMA_FILE, START, SURFACES, ZOD_ERROR, argsOf, schemaFile, world } from './world'

const PALETTE = new Set<string>(Object.values(PICO8))

/** Every colour drawn is PICO-8, and no glyph is double width. */
const expectPaletteAndSingleWidth = (tree: unknown) => {
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

const mount = (
  $: Parameters<Parameters<typeof test>[1]>[0],
  surface: (typeof SURFACES)[number],
) => $.ui.mount({ plugin: 'mender', surface, component: 'Pane', requestId: 'mender', props: PANE_PROPS })

describe('PATCH LOG pane', () => {
  for (const surface of SURFACES) {
    test(`an empty log says so on ${surface}`, async ($, on) => {
      world(on)
      await $.session.start(START)
      const ui = await mount($, surface)
      expect(await ui.find({ type: 'Text', text: ' MENDER ' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'NOTHING TO MEND YET.' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'NONE. CLEAN RUN.' })).toBeDefined()
      expectPaletteAndSingleWidth(await ui.drawn())
    })

    test(`lists repairs, recurring errors and down servers on ${surface}`, async ($, on) => {
      const w = world(on, { [SCHEMA_FILE]: schemaFile() })
      await $.session.start(START)
      await $.tool.call({ tool: 'mcp__notes__create', title: 'x', draft: 'true', colour: 'red' } as never)
      w.answers.push({ error: ZOD_ERROR }, { error: 'MCP server "wiki" is not connected' })
      await $.tool.call({ tool: 'mcp__docs__search', limit: '5' } as never)
      await $.tool.call({ tool: 'mcp__wiki__get', id: 'a' } as never)

      const ui = await mount($, surface)
      expect(await ui.find({ type: 'Text', text: '1 CALL FIXED' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'draft: "true" → true (boolean)' })).toBeDefined()
      const dropped = await ui.find({ type: 'Text', text: /colour: dropped/ })
      expect(dropped?.props.color).toBe(PICO8.b)
      expect(await ui.find({ type: 'Text', text: /docs\/search/ })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: /WIKI DOWN/ }))?.props.color).toBe(PICO8.r)
      expectPaletteAndSingleWidth(await ui.drawn())
    })

    test(`TURN OFF and CLEAR LOG work on ${surface}`, async ($, on) => {
      const w = world(on, { [SCHEMA_FILE]: schemaFile() })
      await $.session.start(START)
      await $.tool.call({ tool: 'mcp__notes__create', title: 'x', draft: 'true' } as never)
      const ui = await mount($, surface)

      await ui.press({ key: 'mender-clear' })
      expect(await ui.find({ type: 'Text', text: '0 CALLS FIXED' })).toBeDefined()
      expect(w.statuses.at(-1)).toBeUndefined()

      await ui.press({ key: 'mender-toggle' })
      expect((await ui.find({ key: 'mender-toggle' }))?.props.label).toBe('TURN ON')
      await $.tool.call({ tool: 'mcp__notes__create', title: 'x', draft: 'true' } as never)
      expect(argsOf(w.ran.at(-1))).toEqual({ title: 'x', draft: 'true' })
    })

    test(`FORGET LEARNED clears learned shapes on ${surface}`, async ($, on) => {
      const learned = { mcp__docs__search: { type: 'object', properties: { limit: { type: 'number' } } } }
      const w = world(on, {}, { learned })
      await $.session.start(START)
      const ui = await mount($, surface)
      expect(await ui.find({ type: 'Text', text: /1 LEARNED/ })).toBeDefined()
      await ui.press({ key: 'mender-forget' })
      expect(await ui.find({ type: 'Text', text: /0 LEARNED/ })).toBeDefined()
      expect(w.store.learned).toEqual({})
    })
  }
})
