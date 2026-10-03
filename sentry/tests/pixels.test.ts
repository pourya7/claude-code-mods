import { describe, expect, test } from 'claude-code/testing'

import { halfBlockRows, LEVEL_COLOR, PICO, plainRows, TOWER } from '../hooks/pixels'

const PALETTE = new Set<string>(Object.values(PICO))

describe('halfBlockRows', () => {
  test('two pixel rows per terminal row, top as color and bottom as background', () => {
    expect(halfBlockRows(['ab', 'a.'].map(line => line.replaceAll('a', 'k').replaceAll('b', 'w')), PICO.red)).toEqual([
      [{ text: '▀', color: PICO.black, backgroundColor: PICO.black }, { text: '▀', color: PICO.white }],
    ])
  })

  test('bottom-only pixels draw as a lower half block, empty cells as spaces', () => {
    expect(halfBlockRows(['..', '.k'], PICO.red)).toEqual([[{ text: ' ' }, { text: '▄', color: PICO.black }]])
  })

  test('same-styled neighbours merge into one run', () => {
    expect(halfBlockRows(['kkk', 'kkk'], PICO.red)).toEqual([
      [{ text: '▀▀▀', color: PICO.black, backgroundColor: PICO.black }],
    ])
  })

  test('the beacon takes the colour it is given', () => {
    const rows = halfBlockRows(TOWER, PICO.red)
    expect(rows).toHaveLength(6)
    expect(rows[0]?.some(run => run.color === PICO.red)).toBe(true)
  })

  test('the tower uses the PICO-8 palette only and stays 12 columns wide', () => {
    for (const color of Object.values(LEVEL_COLOR)) expect(PALETTE.has(color)).toBe(true)
    for (const runs of halfBlockRows(TOWER, PICO.lime)) {
      for (const run of runs) {
        if (run.color) expect(PALETTE.has(run.color)).toBe(true)
        if (run.backgroundColor) expect(PALETTE.has(run.backgroundColor)).toBe(true)
      }
    }
    for (const line of plainRows(TOWER)) expect(line).toHaveLength(12)
  })
})
