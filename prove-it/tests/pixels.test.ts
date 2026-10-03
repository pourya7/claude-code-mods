import { describe, expect, test } from 'claude-code/testing'

import { CRACKED, CROSS, FLASK, PALETTE, STAR, pixelRows } from '../hooks/pixels'

const PICO8 = [
  '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
  '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
]

describe('pixels', () => {
  test('the palette is PICO-8 only, sixteen colours', () => {
    expect(new Set(Object.values(PALETTE)).size).toBe(16)
    for (const hex of Object.values(PALETTE)) expect(PICO8).toContain(hex)
  })

  test('two pixel rows fold into one text row of half blocks', () => {
    expect(pixelRows(['r.y.', 'ry.y'])[0]).toEqual([
      { text: '▀', color: PALETTE.r, backgroundColor: PALETTE.r },
      { text: '▄', color: PALETTE.y },
      { text: '▀', color: PALETTE.y },
      { text: '▄', color: PALETTE.y },
    ])
  })

  test('runs of one style merge; transparent cells are spaces', () => {
    expect(pixelRows(['rr..', 'rr..'])[0]).toEqual([{ text: '▀▀', color: PALETTE.r, backgroundColor: PALETTE.r }, { text: '  ' }])
  })

  test('every sprite is 8 x 8, four text rows, palette keys only', () => {
    for (const sprite of [FLASK, STAR, CROSS, CRACKED]) {
      expect(sprite).toHaveLength(8)
      for (const line of sprite) {
        expect(line).toHaveLength(8)
        for (const key of line) expect(key === '.' || key in PALETTE).toBe(true)
      }
      expect(pixelRows(sprite)).toHaveLength(4)
    }
  })
})
