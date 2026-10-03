import { describe, expect, test } from 'claude-code/testing'

import { PICO8, TRAP_SPRITE, spriteRuns } from '../hooks/sprite'

describe('spriteRuns', () => {
  test('two pixel rows become one row of half blocks, runs merged', () => {
    const rows = spriteRuns(['rr.w', 'rk..'])
    expect(rows).toEqual([
      [
        { text: '▀', color: PICO8.r, backgroundColor: PICO8.r },
        { text: '▀', color: PICO8.r, backgroundColor: PICO8.k },
        { text: ' ' },
        { text: '▀', color: PICO8.w },
      ],
    ])
  })

  test('a transparent top over a colored bottom draws a lower half block', () => {
    expect(spriteRuns(['..', 'rr'])).toEqual([[{ text: '▄▄', color: PICO8.r }]])
  })

  test('an odd row count pads with transparency', () => {
    expect(spriteRuns(['r'])).toEqual([[{ text: '▀', color: PICO8.r }]])
  })

  test('the trap sprite uses PICO-8 keys only and fits a band', () => {
    for (const row of TRAP_SPRITE) {
      for (const pixel of row) expect(pixel === '.' || pixel in PICO8).toBe(true)
    }
    expect(spriteRuns(TRAP_SPRITE).length).toBeLessThanOrEqual(4)
    expect(Object.values(PICO8)).toHaveLength(16)
  })
})
