import { describe, expect, test } from 'claude-code/testing'

import { PALETTE, besides, digitsGrid, pixelRows, HEART } from '../hooks/pixels'

const PICO8 = [
  '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
  '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
]

describe('pixels', () => {
  test('the palette is PICO-8 only', () => {
    for (const hex of Object.values(PALETTE)) expect(PICO8).toContain(hex)
  })

  test('two pixel rows fold into one text row of half blocks', () => {
    const rows = pixelRows(['o.r.', 'or.r'])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual([
      { text: '▀', color: PALETTE.o, backgroundColor: PALETTE.o },
      { text: '▄', color: PALETTE.r },
      { text: '▀', color: PALETTE.r },
      { text: '▄', color: PALETTE.r },
    ])
  })

  test('runs of one style merge and transparent cells are spaces', () => {
    const rows = pixelRows(['oo..', 'oo..'])
    expect(rows[0]).toEqual([{ text: '▀▀', color: PALETTE.o, backgroundColor: PALETTE.o }, { text: '  ' }])
  })

  test('an odd height pads a transparent bottom row', () => {
    expect(pixelRows(['o', 'o', 'o'])).toEqual([
      [{ text: '▀', color: PALETTE.o, backgroundColor: PALETTE.o }],
      [{ text: '▀', color: PALETTE.o }],
    ])
  })

  test('digits are 6 pixels tall (3 rows) with a gap between them', () => {
    const grid = digitsGrid(30)
    expect(grid).toHaveLength(6)
    expect(grid[0]).toHaveLength(3 + 1 + 3)
    expect(pixelRows(grid)).toHaveLength(3)
    expect(digitsGrid(300)[0]).toHaveLength(11)
  })

  test('every digit draws something different', () => {
    const shapes = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => digitsGrid(n).join('/')))
    expect(shapes.size).toBe(10)
  })

  test('besides lines sprites up with a gap', () => {
    expect(besides([['a', 'b'], ['cc']], 1)).toEqual(['a.cc', 'b...'])
    expect(HEART.length).toBe(6)
  })
})
