/**
 * Half-block pixel art: a sprite is a grid of palette keys ('.' is
 * transparent); two pixel rows fold into one text row, the top pixel as the
 * `▀`'s color and the bottom one as its background.
 */

/** PICO-8, keyed by one letter. */
export const PALETTE = {
  k: '#000000', // black
  n: '#1D2B53', // navy: the scope's glass
  m: '#7E2553', // plum
  g: '#008751', // green
  b: '#AB5236', // brown
  d: '#5F574F', // dark grey: crosshair and range ring
  l: '#C2C3C7', // light grey: the beam
  w: '#FFF1E8', // white
  r: '#FF004D', // red
  o: '#FFA300', // orange
  y: '#FFEC27', // yellow
  e: '#00E436', // lime
  u: '#29ADFF', // blue
  v: '#83769C', // lavender: radar's signature
  i: '#FF77A8', // pink: a ping
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

/** Folds a grid into text rows of styled runs, merging neighbours of one style. */
export const pixelRows = (grid: readonly string[]): Run[][] => {
  const rows: Run[][] = []
  const width = Math.max(0, ...grid.map(line => line.length))
  for (let y = 0; y < grid.length; y += 2) {
    const runs: Run[] = []
    for (let x = 0; x < width; x += 1) {
      const cell = cellOf(colorOf(grid[y]?.[x]), colorOf(grid[y + 1]?.[x]))
      const last = runs[runs.length - 1]
      const isSame = last !== undefined && last.text[0] === cell.text && last.color === cell.color && last.backgroundColor === cell.backgroundColor
      if (last && isSame) last.text += cell.text
      else runs.push({ ...cell })
    }
    rows.push(runs)
  }
  return rows
}

const SIZE = 13
const CENTER = 6
/** Where up to three recent pings glow, inside the glass. */
const BLIPS: readonly (readonly [number, number])[] = [
  [9, 4],
  [3, 8],
  [8, 9],
]

const beamCells = (frame: number): [number, number][] => {
  const angle = ((((frame % 8) + 8) % 8) * Math.PI) / 4
  const cells: [number, number][] = []
  for (let r = 1; r <= 5; r += 1) {
    cells.push([CENTER + Math.round(Math.cos(angle) * r), CENTER - Math.round(Math.sin(angle) * r)])
  }
  return cells
}

/**
 * The scope: a 13 x 13 lavender-rimmed navy disc with a crosshair and range
 * ring, the beam at frame * 45 degrees with a lavender trail behind it, and up
 * to three pink blips; one transparent row under it makes 7 text rows.
 */
export const sweepGrid = (frame: number, blips: number): string[] => {
  const grid: string[][] = []
  for (let y = 0; y < SIZE; y += 1) {
    const row: string[] = []
    for (let x = 0; x < SIZE; x += 1) {
      const distance = Math.hypot(x - CENTER, y - CENTER)
      if (distance > 6.5) row.push('.')
      else if (distance > 5.5) row.push('v')
      else if (x === CENTER || y === CENTER || (distance > 2.5 && distance <= 3.4)) row.push('d')
      else row.push('n')
    }
    grid.push(row)
  }
  const paint = (cells: readonly (readonly [number, number])[], key: string) => {
    for (const [x, y] of cells) {
      const row = grid[y]
      if (row !== undefined && x >= 0 && x < SIZE) row[x] = key
    }
  }
  paint(beamCells(frame - 1), 'v')
  paint(beamCells(frame), 'l')
  paint([[CENTER, CENTER]], 'w')
  paint(BLIPS.slice(0, Math.max(0, Math.min(3, blips))), 'i')
  return [...grid.map(row => row.join('')), '.'.repeat(SIZE)]
}
