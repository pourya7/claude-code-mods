import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PALETTE } from '../hooks/pixels'
import { BAND_PROPS, FAIL_HIGH, PANE_PROPS, PASS, START, SURFACES, world } from './world'

const COLORS = new Set<string>(Object.values(PALETTE))

/** Every colour drawn is PICO-8, and no glyph is double width (★ is single width and allowed). */
const expectPixelArt = (tree: unknown) => {
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      expect(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{2604}\u{2606}-\u{26FF}\u{2700}-\u{27BF}]/u.test(node)).toBe(false)
      return
    }
    if (typeof node !== 'object' || node === null) return
    const element = node as { props?: Record<string, unknown>; children?: unknown[] }
    for (const key of ['color', 'backgroundColor', 'borderColor']) {
      const value = element.props?.[key]
      if (value !== undefined) expect(COLORS.has(String(value))).toBe(true)
    }
    for (const child of element.children ?? []) walk(child)
  }
  walk(tree)
}

const band = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'co-op', surface, component: 'AbovePrompt', props: BAND_PROPS })

const pane = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'co-op', surface, component: 'Pane', requestId: 'co-op', props: PANE_PROPS })

describe('2P REVIEW band', () => {
  for (const surface of SURFACES) {
    test(`stays hidden until there is a review, on ${surface}`, async ($, on) => {
      world(on)
      await $.session.start(START)
      const ui = await band($, surface)
      expect(await ui.find({ key: 'coop-title' })).toBeUndefined()
    })

    test(`shows a blocked review with counts by severity, on ${surface}`, async ($, on) => {
      world(on, { answers: [{ text: FAIL_HIGH }] })
      await $.session.start(START)
      await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
      const ui = await band($, surface)
      expect((await ui.find({ key: 'coop-title' }))?.text).toContain('2P REVIEW')
      expect((await ui.find({ key: 'coop-verdict' }))?.text).toContain('FAIL')
      expect((await ui.find({ type: 'Text', text: /^FAIL$/ }))?.props.color).toBe(PALETTE.r)
      const counts = await ui.find({ key: 'coop-counts' })
      expect(counts?.text).toContain('1 HIGH')
      expect(counts?.text).toContain('0 MED')
      expect(counts?.text).toContain('1 LOW')
      expect((await ui.find({ key: 'coop-message' }))?.text).toContain('BLOCKED')
      expectPixelArt(await ui.drawn())
    })

    test(`VIEW opens the findings pane and OK hides the band, on ${surface}`, async ($, on) => {
      const w = world(on, { answers: [{ text: PASS }] })
      await $.session.start(START)
      await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
      const ui = await band($, surface)
      expect((await ui.find({ key: 'coop-verdict' }))?.text).toContain('PASS')
      await ui.press({ key: 'coop-view' })
      expect(w.opened).toEqual(['co-op'])
      await ui.press({ key: 'coop-ok' })
      expect(await ui.find({ key: 'coop-title' })).toBeUndefined()
    })

    test(`notes a truncated diff, on ${surface}`, { options: { maxDiffKb: 1 } }, async ($, on) => {
      world(on, { diff: `+${'a'.repeat(99)}\n`.repeat(40), answers: [{ text: PASS }] })
      await $.session.start(START)
      await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
      const ui = await band($, surface)
      expect((await ui.find({ key: 'coop-counts' }))?.text).toContain('DIFF CUT AT 1 KB')
    })
  }
})

describe('findings pane', () => {
  for (const surface of SURFACES) {
    test(`lists every finding with its severity and place, on ${surface}`, async ($, on) => {
      world(on, { answers: [{ text: FAIL_HIGH }] })
      await $.session.start(START)
      await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
      const ui = await pane($, surface)
      expect((await ui.find({ key: 'coop-pane-verdict' }))?.text).toContain('FAIL')
      expect((await ui.find({ key: 'finding-0-tag' }))?.text).toContain('HIGH')
      expect((await ui.find({ type: 'Text', text: /^HIGH$/ }))?.props.color).toBe(PALETTE.r)
      expect((await ui.find({ key: 'finding-0-place' }))?.text).toBe('src/pay.ts:41')
      expect((await ui.find({ key: 'finding-0-summary' }))?.text).toBe('Refund charges the customer instead.')
      expect((await ui.find({ key: 'finding-1-tag' }))?.text).toContain('LOW')
      expect((await ui.find({ key: 'coop-pane-meta' }))?.text).toContain('model:sonnet')
      expectPixelArt(await ui.drawn())
    })

    test(`SKIP NEXT arms and disarms the skip, on ${surface}`, async ($, on) => {
      const w = world(on, { answers: [{ text: FAIL_HIGH }] })
      await $.session.start(START)
      const ui = await pane($, surface)
      expect((await ui.find({ key: 'coop-pane-verdict' }))?.text).toContain('NO REVIEW YET')
      await ui.press({ key: 'coop-skip' })
      expect(w.statuses.at(-1)).toBe('CO-OP ▸ SKIP NEXT')
      expect((await ui.find({ key: 'coop-skip' }))?.props.label).toBe('UNSKIP')
      await ui.press({ key: 'coop-skip' })
      expect(w.statuses.at(-1)).toBe('CO-OP ▸ READY')
      const ran = await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
      expect(ran.deny).toContain('BLOCKED')
    })
  }
})
