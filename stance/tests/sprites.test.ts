import { describe, expect, test } from 'claude-code/testing'
import { BADGES, PICO8, spriteRows } from '../hooks/sprites'
import { STANCES } from '../hooks/stances'

const PALETTE = new Set(Object.values(PICO8))

describe('sprites', () => {
  test('every stance has an 8x8 badge using palette keys only', () => {
    for (const stance of STANCES) {
      const grid = BADGES[stance]
      expect(grid).toHaveLength(8)
      for (const line of grid) {
        expect(line).toHaveLength(8)
        for (const cell of line) {
          if (cell !== '.') expect(PICO8[cell], `${stance} key ${cell}`).toBeDefined()
        }
      }
    }
  })

  test('half-block rows: two pixel rows per text row, PICO-8 colours only', () => {
    const rows = spriteRows(['B.', '.r'])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual([
      { text: '▀', color: PICO8.B },
      { text: '▄', color: PICO8.r },
    ])
    const solid = spriteRows(['BB', 'rr'])
    expect(solid[0]).toEqual([{ text: '▀▀', color: PICO8.B, backgroundColor: PICO8.r }])
    const blank = spriteRows(['..', '..'])
    expect(blank[0]).toEqual([{ text: '  ' }])
    for (const stance of STANCES) {
      const badge = spriteRows(BADGES[stance])
      expect(badge).toHaveLength(4)
      for (const row of badge) {
        for (const run of row) {
          if (run.color) expect(PALETTE.has(run.color)).toBe(true)
          if (run.backgroundColor) expect(PALETTE.has(run.backgroundColor)).toBe(true)
        }
      }
    }
  })
})
