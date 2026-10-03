import { describe, expect, test } from 'claude-code/testing'

import { PICO8, spriteRows } from '../hooks/sprite'

describe('spriteRows', () => {
  test('packs two pixel rows into one text row of half blocks', () => {
    expect(spriteRows(['ab', 'b.'], { a: '#FF004D', b: '#00E436' })).toEqual([
      [
        { text: '▀', color: '#FF004D', backgroundColor: '#00E436' },
        { text: '▀', color: '#00E436' },
      ],
    ])
  })

  test('a lone bottom pixel draws a lower half block; transparent draws a space', () => {
    expect(spriteRows(['..', '.a'], { a: '#FF004D' })).toEqual([[{ text: ' ' }, { text: '▄', color: '#FF004D' }]])
  })

  test('merges runs of the same style', () => {
    expect(spriteRows(['aa'], { a: '#FF004D' })).toEqual([[{ text: '▀▀', color: '#FF004D' }]])
  })

  test('uses PICO-8 colours only', () => {
    expect(Object.values(PICO8)).toHaveLength(16)
  })
})
