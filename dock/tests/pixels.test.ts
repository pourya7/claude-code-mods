import { describe, expect, test } from 'claude-code/testing'

import { CRANE, PALETTE, barGrid, gaugeGrid, pixelRows } from '../hooks/pixels'

const PICO8 = [
  '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
  '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
]

describe('pixels', () => {
  test('the palette is PICO-8 only', () => {
    for (const hex of Object.values(PALETTE)) expect(PICO8).toContain(hex)
  })

  test('two pixel rows fold into one text row of half blocks', () => {
    expect(pixelRows(['u.n.', 'un.n'])[0]).toEqual([
      { text: '▀', color: PALETTE.u, backgroundColor: PALETTE.u },
      { text: '▄', color: PALETTE.n },
      { text: '▀', color: PALETTE.n },
      { text: '▄', color: PALETTE.n },
    ])
  })

  test('the crane is 3 text rows tall and uses only palette keys', () => {
    expect(pixelRows(CRANE)).toHaveLength(3)
    for (const line of CRANE) for (const key of line) expect(key === '.' || key in PALETTE).toBe(true)
  })
})

describe('fuel gauge', () => {
  test('fills with used memory and marks the red line where headroom runs low', () => {
    const grid = gaugeGrid(0.5, 0.75, 8)
    expect(grid).toHaveLength(2)
    expect(grid[0]).toBe('uuuudddd')
    expect(grid[1]).toBe('nnnnkrkk')
  })

  test('past the red line the fill turns red', () => {
    const grid = gaugeGrid(0.9, 0.75, 8)
    expect(grid[0]).toBe('rrrrrrrd')
    expect(grid[1]).toBe('mmmmmmmk')
  })

  test('the fill is clamped to the gauge', () => {
    expect(gaugeGrid(2, 0.5, 4)[0]).toBe('rrrr')
    expect(gaugeGrid(-1, 0.5, 4)[0]).toBe('dddd')
  })

  test('one text row tall', () => {
    expect(pixelRows(gaugeGrid(0.3, 0.6, 10))).toHaveLength(1)
  })
})

describe('memory bar', () => {
  test('a stack bar fills by its share of the engine', () => {
    expect(barGrid(0.25, 8)).toEqual(['uudddddd', 'nnkkkkkk'])
    expect(barGrid(0.25, 8, 'r')[0]).toBe('rrdddddd')
  })

  test('any memory at all shows at least one pixel', () => {
    expect(barGrid(0.001, 8)[0]).toBe('uddddddd')
    expect(barGrid(0, 8)[0]).toBe('dddddddd')
  })
})
