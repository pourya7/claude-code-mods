import { describe, expect, test } from 'claude-code/testing'

import { BANNER, CLASS_ICON, KEYS, PICO, barText, halfBlockRows, plainRows } from '../hooks/pixels'

const PALETTE = new Set<string>(Object.values(PICO))
const SPRITES = { BANNER, ...CLASS_ICON }

describe('pixels', () => {
  test('every key maps to a PICO-8 colour', () => {
    for (const color of Object.values(KEYS)) expect(PALETTE.has(color)).toBe(true)
  })

  for (const [name, grid] of Object.entries(SPRITES)) {
    test(`${name} uses palette keys only, is rectangular and fits two pixel rows per line`, () => {
      const width = grid[0]?.length ?? 0
      expect(grid.length % 2).toBe(0)
      expect(grid.length / 2).toBeLessThanOrEqual(6)
      for (const line of grid) {
        expect(line.length).toBe(width)
        for (const key of line) expect(key === '.' || key in KEYS).toBe(true)
      }
    })
  }

  test('half blocks: top pixel is the colour, bottom the background', () => {
    const rows = halfBlockRows(['i.', 'ru'])
    expect(rows).toEqual([[{ text: '▀', color: PICO.pink, backgroundColor: PICO.red }, { text: '▄', color: PICO.blue }]])
  })

  test('same-styled neighbours merge into one run', () => {
    expect(halfBlockRows(['ii', 'ii'])[0]).toEqual([{ text: '▀▀', color: PICO.pink, backgroundColor: PICO.pink }])
  })

  test('the capture is single-width block characters only', () => {
    for (const line of plainRows(BANNER)) expect(line).toMatch(/^[ ▀▄]+$/)
  })

  test('barText fills and clamps', () => {
    expect(barText(3, 5)).toEqual({ full: '███', empty: '░░' })
    expect(barText(9, 5)).toEqual({ full: '█████', empty: '' })
  })
})
