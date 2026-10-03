// Pixel art: the PICO-8 palette, party's class icons and a half-block renderer.
import type { PartyState } from '../types'
import type { BarColor } from './party'

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

/** party's signature colour. */
export const SIGNATURE = PICO.pink

/** One letter per palette colour; `.` is transparent. */
export const KEYS: Readonly<Record<string, string>> = {
  k: PICO.black,
  n: PICO.navy,
  m: PICO.plum,
  e: PICO.green,
  b: PICO.brown,
  g: PICO.darkGrey,
  s: PICO.lightGrey,
  w: PICO.white,
  r: PICO.red,
  o: PICO.orange,
  y: PICO.yellow,
  l: PICO.lime,
  u: PICO.blue,
  v: PICO.lavender,
  i: PICO.pink,
  p: PICO.peach,
}

/** The class icon per state, 5 x 4 pixels (2 terminal rows). */
export const CLASS_ICON: Record<PartyState, readonly string[]> = {
  // A blue knight with a raised sword: busy.
  working: ['.uu.w', 'uppuw', '.uuo.', '.u.u.'],
  // A pink mage with a red "!": needs you.
  'waiting-on-you': ['.ii.r', 'ippir', '.ii..', '.i.ir'],
  // A grey sleeper, eyes shut, a lavender "z".
  idle: ['.ss.v', 'sggs.', '.ss.v', '.s.s.'],
  // A gold star: quest complete.
  done: ['..y..', 'yyyyy', '.yyy.', '.y.y.'],
}

/** The banner: three party members side by side, 14 x 4 pixels. */
export const BANNER: readonly string[] = [
  '.uu...ii...ll.',
  'uppu.ippi.lppl',
  '.uu...ii...ll.',
  'u..u.i..i.l..l',
]

export const STATE_COLOR: Record<PartyState, string> = {
  working: PICO.blue,
  'waiting-on-you': PICO.pink,
  idle: PICO.lightGrey,
  done: PICO.yellow,
}

export const BAR_COLOR: Record<BarColor, string> = {
  lime: PICO.lime,
  yellow: PICO.yellow,
  red: PICO.red,
}

/** One run of same-styled cells in a terminal row. */
export type PixelRun = { text: string; color?: string; backgroundColor?: string }

function colorAt(grid: readonly string[], row: number, column: number): string | undefined {
  const key = grid[row]?.[column] ?? '.'
  return key === '.' ? undefined : KEYS[key]
}

/**
 * Two pixel rows per terminal row: `▀` with the top pixel as `color` and the
 * bottom as `backgroundColor`; `▄` when only the bottom is set; a space when
 * neither. Adjacent cells with the same style merge into one run.
 */
export function halfBlockRows(grid: readonly string[]): PixelRun[][] {
  const width = Math.max(0, ...grid.map(line => line.length))
  const rows: PixelRun[][] = []
  for (let top = 0; top < grid.length; top += 2) {
    const runs: PixelRun[] = []
    for (let column = 0; column < width; column += 1) {
      const upper = colorAt(grid, top, column)
      const lower = colorAt(grid, top + 1, column)
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
  return halfBlockRows(grid).map(runs => runs.map(run => run.text).join(''))
}

/** The HP-style bar as text: `filled` full cells, the rest light shade. */
export function barText(filled: number, cells: number): { full: string; empty: string } {
  const clamped = Math.max(0, Math.min(cells, filled))
  return { full: '█'.repeat(clamped), empty: '░'.repeat(cells - clamped) }
}
