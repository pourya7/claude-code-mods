/**
 * Half-block pixel art: a sprite is a grid of palette keys ('.' is
 * transparent); two pixel rows fold into one text row, the top pixel as the
 * `▀`'s color and the bottom one as its background.
 */

/** PICO-8, keyed by one letter. */
export const PALETTE = {
  k: '#000000', // black
  n: '#1D2B53', // navy
  p: '#7E2553', // plum
  g: '#008751', // green
  b: '#AB5236', // brown
  d: '#5F574F', // dark grey
  l: '#C2C3C7', // light grey
  w: '#FFF1E8', // white
  r: '#FF004D', // red: prove-it's signature
  o: '#FFA300', // orange
  y: '#FFEC27', // yellow
  i: '#00E436', // lime
  u: '#29ADFF', // blue
  v: '#83769C', // lavender
  m: '#FF77A8', // pink
  e: '#FFCCAA', // peach
} as const

export type Run = { text: string; color?: string; backgroundColor?: string }

const colorOf = (key: string | undefined): string | undefined =>
  key === undefined || key === '.' ? undefined : (PALETTE as Record<string, string>)[key]

const cellOf = (top: string | undefined, bottom: string | undefined): Run => {
  if (top && bottom) return { text: '▀', color: top, backgroundColor: bottom }
  if (top) return { text: '▀', color: top }
  if (bottom) return { text: '▄', color: bottom }

  return { text: ' ' }
}

const sameStyle = (a: Run, b: Run): boolean => a.color === b.color && a.backgroundColor === b.backgroundColor

/** Folds a grid into text rows of styled runs, merging neighbours of one style. */
export const pixelRows = (grid: readonly string[]): Run[][] => {
  const rows: Run[][] = []
  const width = Math.max(0, ...grid.map(line => line.length))
  for (let y = 0; y < grid.length; y += 2) {
    const runs: Run[] = []
    for (let x = 0; x < width; x += 1) {
      const cell = cellOf(colorOf(grid[y]?.[x]), colorOf(grid[y + 1]?.[x]))
      const last = runs[runs.length - 1]
      if (last && last.text[0] === cell.text && sameStyle(last, cell)) last.text += cell.text
      else runs.push({ ...cell })
    }
    rows.push(runs)
  }

  return rows
}

/** A test tube bubbling red: the proof is running. 8 x 8 pixels, 4 rows. */
export const FLASK = [
  '..wwww..',
  '...ll...',
  '...ll.r.',
  '..l..l..',
  '.l.r..l.',
  'lrrrrrrl',
  'lrrwrrrl',
  '.llllll.',
]

/** A gold star: proven. */
export const STAR = [
  '...yy...',
  '...yy...',
  'yyyyyyyy',
  '.yywwyy.',
  '..yyyy..',
  '.yyyyyy.',
  '.yy..yy.',
  'yo....oy',
]

/** A red cross: not proven, broken, or nothing to show. */
export const CROSS = [
  'rr....rr',
  'rrr..rrr',
  '.rrrrrr.',
  '..rrrr..',
  '..rrrr..',
  '.rrrrrr.',
  'rrr..rrr',
  'rr....rr',
]

/** A cracked tube spilling orange: the proof could not run, or the restore failed. */
export const CRACKED = [
  '..wwww..',
  '...ll...',
  '...ll...',
  '..l..l..',
  '.l.l..l.',
  'lo..l..l',
  'loo.l.ol',
  '.llo.ll.',
]
