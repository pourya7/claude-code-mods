// 8-bit art: the PICO-8 palette, the watchtower sprite and a half-block renderer.
import type { Level } from './truth'

export const PICO = {
  black: '#000000',
  navy: '#1D2B53',
  plum: '#7E2553',
  green: '#008751',
  brown: '#AB5236',
  darkGrey: '#5F574F',
  lightGrey: '#C2C3C7',
  white: '#FFF1E8',
  red: '#FF004D',
  orange: '#FFA300',
  yellow: '#FFEC27',
  lime: '#00E436',
  blue: '#29ADFF',
  lavender: '#83769C',
  pink: '#FF77A8',
  peach: '#FFCCAA',
} as const

/** Sentry's signature colour. */
export const SIGNATURE = PICO.yellow

export const LEVEL_COLOR: Record<Level, string> = {
  failed: PICO.red,
  error: PICO.plum,
  attention: PICO.orange,
  waiting: PICO.yellow,
  ready: PICO.lime,
  done: PICO.lavender,
  idle: PICO.darkGrey,
}

export const LEVEL_LABEL: Record<Level, string> = {
  failed: 'ALERT! CI FAILED',
  error: 'NO SIGNAL (GH)',
  attention: 'HEADS UP: REVIEW',
  waiting: 'ON WATCH...',
  ready: 'ALL CLEAR! READY',
  done: 'GAME OVER: DONE',
  idle: 'INSERT COIN',
}

/**
 * The watchtower, 12 x 12 pixels (6 terminal rows). `*` is the beacon,
 * coloured by the worst PR; `.` is transparent.
 */
export const TOWER: readonly string[] = [
  '..*..**..*..',
  '....*yy*....',
  '..nnnnnnnn..',
  '...nnnnnn...',
  '...bwbbwb...',
  '...bbbbbb...',
  '....b..b....',
  '....bbbb....',
  '....b..b....',
  '...b....b...',
  '..b......b..',
  'gggggggggggg',
]

const KEYS: Record<string, string> = {
  k: PICO.black,
  n: PICO.navy,
  b: PICO.brown,
  g: PICO.green,
  w: PICO.white,
  y: PICO.yellow,
}

/** One run of same-styled cells in a terminal row. */
export type PixelRun = { text: string; color?: string; backgroundColor?: string }

function colorAt(grid: readonly string[], row: number, column: number, beacon: string): string | undefined {
  const key = grid[row]?.[column] ?? '.'
  if (key === '.') return undefined
  if (key === '*') return beacon
  return KEYS[key]
}

/**
 * Two pixel rows per terminal row: `▀` with the top pixel as `color` and the
 * bottom as `backgroundColor`; `▄` when only the bottom is set; a space when
 * neither. Adjacent cells with the same style merge into one run.
 */
export function halfBlockRows(grid: readonly string[], beacon: string): PixelRun[][] {
  const width = Math.max(0, ...grid.map(line => line.length))
  const rows: PixelRun[][] = []
  for (let top = 0; top < grid.length; top += 2) {
    const runs: PixelRun[] = []
    for (let column = 0; column < width; column += 1) {
      const upper = colorAt(grid, top, column, beacon)
      const lower = colorAt(grid, top + 1, column, beacon)
      const cell: PixelRun =
        upper !== undefined
          ? lower !== undefined
            ? { text: '▀', color: upper, backgroundColor: lower }
            : { text: '▀', color: upper }
          : lower !== undefined
            ? { text: '▄', color: lower }
            : { text: ' ' }
      const last = runs[runs.length - 1]
      if (last && last.color === cell.color && last.backgroundColor === cell.backgroundColor && last.text[0] === cell.text) {
        last.text += cell.text
      } else {
        runs.push(cell)
      }
    }
    rows.push(runs)
  }
  return rows
}

/** The plain-text capture of a sprite (what a monochrome terminal shows). */
export function plainRows(grid: readonly string[]): string[] {
  return halfBlockRows(grid, PICO.yellow).map(runs => runs.map(run => run.text).join(''))
}
