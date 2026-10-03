import { describe, expect, test } from 'claude-code/testing'

import { FLOPPY, PALETTE, pixelRows } from '../hooks/pixels'

const PICO8 = [
  '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
  '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
]

describe('pixels', () => {
  test('the palette is PICO-8 only', () => {
    for (const hex of Object.values(PALETTE)) expect(PICO8).toContain(hex)
  })

  test('two pixel rows fold into one text row of half blocks', () => {
    const rows = pixelRows(['g.w.', 'gw.w'])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual([
      { text: '▀', color: PALETTE.g, backgroundColor: PALETTE.g },
      { text: '▄', color: PALETTE.w },
      { text: '▀', color: PALETTE.w },
      { text: '▄', color: PALETTE.w },
    ])
  })

  test('runs of one style merge and transparent cells are spaces', () => {
    expect(pixelRows(['gg..', 'gg..'])[0]).toEqual([
      { text: '▀▀', color: PALETTE.g, backgroundColor: PALETTE.g },
      { text: '  ' },
    ])
  })

  test('the floppy is 8x8, four text rows, only palette keys', () => {
    expect(FLOPPY).toHaveLength(8)
    for (const line of FLOPPY) {
      expect(line).toHaveLength(8)
      for (const key of line) expect(key === '.' || key in PALETTE).toBe(true)
    }
    expect(pixelRows(FLOPPY)).toHaveLength(4)
  })
})
