import { describe, expect, test } from 'claude-code/testing'

import { PICO8, EXIT_SPRITE, spriteRuns } from '../hooks/sprite'
import { PANE_PROPS, START, SURFACES, world } from './world'

const PALETTE = new Set<string>(Object.values(PICO8))

/** Every colour drawn is PICO-8, and no glyph is double width. */
const expectPixelArt = (tree: unknown) => {
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

describe('sprite', () => {
  test('the exit sprite uses PICO-8 keys only and packs two pixel rows per line', () => {
    for (const row of EXIT_SPRITE) expect(/^[.kndlwrwoyiuvmepgb]*$/.test(row)).toBe(true)
    const rows = spriteRuns(EXIT_SPRITE)
    expect(rows).toHaveLength(Math.ceil(EXIT_SPRITE.length / 2))
    expect(rows.length).toBeLessThanOrEqual(6)
    for (const row of rows) for (const run of row) expect(/^[▀▄ ]+$/.test(run.text)).toBe(true)
  })

  test('top pixel is the colour, bottom pixel the background', () => {
    const [row] = spriteRuns(['e', 'k'])
    expect(row).toEqual([{ text: '▀', color: PICO8.e, backgroundColor: PICO8.k }])
    expect(spriteRuns(['.', 'e'])[0]).toEqual([{ text: '▄', color: PICO8.e }])
    expect(spriteRuns(['.', '.'])[0]).toEqual([{ text: ' ' }])
  })
})

describe('HONEST EXIT pane', () => {
  for (const surface of SURFACES) {
    test(`shows the count and each catch on ${surface}`, async ($, on) => {
      const w = world(on)
      await $.session.start(START)
      w.answer = { kind: 'error', text: 'zsh: no matches found: *.log' }
      await $.tool.call({ tool: 'Bash', command: 'rm *.log' })
      w.answer = { kind: 'ok', stdout: '1 failing' }
      await $.tool.call({ tool: 'Bash', command: 'npm test | tail -3' })

      const ui = await $.ui.mount({ plugin: 'honest-exit', surface, component: 'Pane', requestId: 'honest-exit', props: PANE_PROPS })
      const header = await ui.find({ type: 'Text', text: /HONEST EXIT/ })
      expect(header?.props.color).toBe(PICO8.e)
      expect(await ui.find({ type: 'Text', text: /2 CAUGHT/ })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: /^GLOB/ }))?.props.color).toBe(PICO8.o)
      expect((await ui.find({ type: 'Text', text: /^PIPE/ }))?.props.color).toBe(PICO8.r)
      expect(await ui.find({ type: 'Text', text: /rm \*\.log/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /npm test \| tail -3/ })).toBeDefined()
      expectPixelArt(await ui.drawn())
    })

    test(`says ALL CLEAR when nothing was caught on ${surface}`, async ($, on) => {
      world(on)
      await $.session.start(START)
      const ui = await $.ui.mount({ plugin: 'honest-exit', surface, component: 'Pane', requestId: 'honest-exit', props: PANE_PROPS })
      expect(await ui.find({ type: 'Text', text: /ALL CLEAR/ })).toBeDefined()
      expectPixelArt(await ui.drawn())
    })

    test(`the CLEAR button resets the count on ${surface}`, async ($, on) => {
      const w = world(on)
      await $.session.start(START)
      w.answer = { kind: 'error', text: 'zsh: no matches found: *.log' }
      await $.tool.call({ tool: 'Bash', command: 'rm *.log' })
      const ui = await $.ui.mount({ plugin: 'honest-exit', surface, component: 'Pane', requestId: 'honest-exit', props: PANE_PROPS })
      await ui.press({ key: 'honest-exit-clear' })
      expect(await ui.find({ type: 'Text', text: /ALL CLEAR/ })).toBeDefined()
      expect(w.statuses.at(-1)).toBeUndefined()
    })
  }
})
