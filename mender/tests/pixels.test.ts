import { describe, expect, test } from 'claude-code/testing'

import { DOWN_SOCK_SPRITE, PICO8, SOCK_SPRITE, spriteRuns } from '../hooks/pixels'

const KEYS = new Set(['.', ...Object.keys(PICO8)])

describe('sprites', () => {
  for (const [name, grid] of [['sock', SOCK_SPRITE], ['down sock', DOWN_SOCK_SPRITE]] as const) {
    test(`${name} uses palette keys only and folds into at most 6 rows`, () => {
      for (const line of grid) for (const pixel of line) expect(KEYS.has(pixel)).toBe(true)
      const rows = spriteRuns(grid)
      expect(rows.length).toBeLessThanOrEqual(6)
      for (const row of rows) {
        expect(row.map(run => run.text).join('').length).toBe(12)
        for (const run of row) expect(/^[▀▄ ]+$/.test(run.text)).toBe(true)
      }
    })
  }

  test('the top pixel is the color, the bottom one the background', () => {
    expect(spriteRuns(['o', 'b'])).toEqual([[{ text: '▀', color: PICO8.o, backgroundColor: PICO8.b }]])
    expect(spriteRuns(['.', 'b'])).toEqual([[{ text: '▄', color: PICO8.b }]])
    expect(spriteRuns(['o', '.'])).toEqual([[{ text: '▀', color: PICO8.o }]])
    expect(spriteRuns(['..', '..'])).toEqual([[{ text: '  ' }]])
  })
})
