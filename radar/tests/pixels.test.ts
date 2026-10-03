import { describe, expect, test } from 'claude-code/testing'

import { PALETTE, pixelRows, sweepGrid } from '../hooks/pixels'

const PICO8 = [
  '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
  '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
]

describe('pixels', () => {
  test('the palette is PICO-8 only, with lavender as the signature', () => {
    for (const hex of Object.values(PALETTE)) expect(PICO8).toContain(hex)
    expect(PALETTE.v).toBe('#83769C')
  })

  test('two pixel rows fold into one text row of half blocks', () => {
    expect(pixelRows(['v.', 'vn'])).toEqual([[{ text: '▀', color: PALETTE.v, backgroundColor: PALETTE.v }, { text: '▄', color: PALETTE.n }]])
  })

  test('runs of one style merge and transparent cells are spaces', () => {
    expect(pixelRows(['vv..', 'vv..'])).toEqual([[{ text: '▀▀', color: PALETTE.v, backgroundColor: PALETTE.v }, { text: '  ' }]])
  })

  test('the sweep is a 13 x 14 lavender scope, 7 text rows tall', () => {
    const grid = sweepGrid(0, 0)
    expect(grid).toHaveLength(14)
    expect(grid.every(line => line.length === 13)).toBe(true)
    expect(pixelRows(grid)).toHaveLength(7)
    expect(grid.join('')).toContain('v')
  })

  test('the beam turns with the frame', () => {
    expect(sweepGrid(0, 0)).not.toEqual(sweepGrid(1, 0))
    expect(sweepGrid(0, 0)).toEqual(sweepGrid(8, 0))
  })

  test('blips show up to three recent pings in pink', () => {
    const count = (grid: string[]) => grid.join('').split('i').length - 1
    expect(count(sweepGrid(0, 0))).toBe(0)
    expect(count(sweepGrid(0, 2))).toBe(2)
    expect(count(sweepGrid(0, 9))).toBe(3)
  })
})
