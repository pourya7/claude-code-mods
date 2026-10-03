import type { Stance } from './stances'

/** PICO-8, keyed by one character each; `.` is transparent. */
export const PICO8: Record<string, string> = {
  k: '#000000',
  n: '#1D2B53',
  p: '#7E2553',
  g: '#008751',
  b: '#AB5236',
  d: '#5F574F',
  l: '#C2C3C7',
  w: '#FFF1E8',
  r: '#FF004D',
  o: '#FFA300',
  y: '#FFEC27',
  L: '#00E436',
  B: '#29ADFF',
  v: '#83769C',
  P: '#FF77A8',
  e: '#FFCCAA',
}

/** The class badge per stance: magnifier, quill, hammer, rocket. 8x8 pixels. */
export const BADGES: Record<Stance, readonly string[]> = {
  investigate: [
    '.wwww...',
    'wBBwBw..',
    'wBBBBw..',
    'wBBBBw..',
    '.wwww...',
    '....bb..',
    '.....bb.',
    '......bb',
  ],
  draft: [
    '......ww',
    '.....wlw',
    '....wlw.',
    '...wlw..',
    '..wlw...',
    '..ww....',
    '.y......',
    'y.......',
  ],
  build: [
    'lllllll.',
    'lwwwwwl.',
    'lllllll.',
    '...bb...',
    '...bb...',
    '...bb...',
    '...bb...',
    '...bb...',
  ],
  ship: [
    '...ww...',
    '..wwww..',
    '..wBBw..',
    '..wwww..',
    '..wwww..',
    '.rwwwwr.',
    '.r.oo.r.',
    '...yy...',
  ],
}

/** One run of same-styled cells in a text row. */
export type SpriteRun = { text: string; color?: string; backgroundColor?: string }

const cellOf = (top: string, bottom: string): SpriteRun => {
  const topColor = PICO8[top]
  const bottomColor = PICO8[bottom]
  if (topColor && bottomColor) return { text: '▀', color: topColor, backgroundColor: bottomColor }
  if (topColor) return { text: '▀', color: topColor }
  if (bottomColor) return { text: '▄', color: bottomColor }
  return { text: ' ' }
}

/**
 * Turns a pixel grid into text rows of half blocks: each text row holds two
 * pixel rows (`▀` coloured top, background bottom), runs of one style merged.
 */
export const spriteRows = (grid: readonly string[]): SpriteRun[][] => {
  const rows: SpriteRun[][] = []
  for (let y = 0; y < grid.length; y += 2) {
    const top = grid[y] ?? ''
    const bottom = grid[y + 1] ?? ''
    const runs: SpriteRun[] = []
    for (let x = 0; x < Math.max(top.length, bottom.length); x++) {
      const cell = cellOf(top[x] ?? '.', bottom[x] ?? '.')
      const last = runs.at(-1)
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
