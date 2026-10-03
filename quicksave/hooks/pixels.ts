/**
 * Half-block pixel art: a sprite is a grid of palette keys ('.' is
 * transparent); two pixel rows fold into one text row, the top pixel as the
 * `▀`'s color and the bottom one as its background.
 */

/** PICO-8, keyed by one letter. */
export const PALETTE = {
  k: '#000000', // black
  n: '#1D2B53', // navy
  m: '#7E2553', // plum
  g: '#008751', // green: quicksave's signature
  b: '#AB5236', // brown
  d: '#5F574F', // dark grey
  l: '#C2C3C7', // light grey
  w: '#FFF1E8', // white
  r: '#FF004D', // red
  o: '#FFA300', // orange
  y: '#FFEC27', // yellow
  e: '#00E436', // lime
  u: '#29ADFF', // blue
  v: '#83769C', // lavender
  i: '#FF77A8', // pink
  c: '#FFCCAA', // peach
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
      else if (last && last.text[0] === ' ' && cell.text === ' ') last.text += ' '
      else runs.push({ ...cell })
    }
    rows.push(runs)
  }

  return rows
}

/** Lines sprites up left to right, `gap` transparent columns apart, tops aligned. */
/** The save icon, 8x8: a green floppy with a grey shutter and a white label. */
export const FLOPPY: readonly string[] = [
  'egllllg.',
  'gglkllgg',
  'ggllllgg',
  'gggggggg',
  'gwwwwwwg',
  'gwddddwg',
  'gwwwwwwg',
  'gggggggg',
]
