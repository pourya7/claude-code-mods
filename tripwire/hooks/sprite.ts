// PICO-8 palette and a tiny half-block sprite renderer: two pixel rows per
// terminal row, the top pixel as the text color, the bottom as the background.

export const PICO8 = {
  k: '#000000', // black
  n: '#1D2B53', // navy
  p: '#7E2553', // plum
  g: '#008751', // green
  b: '#AB5236', // brown
  d: '#5F574F', // dark grey
  l: '#C2C3C7', // light grey
  w: '#FFF1E8', // white
  r: '#FF004D', // red (tripwire's signature)
  o: '#FFA300', // orange
  y: '#FFEC27', // yellow
  i: '#00E436', // lime
  u: '#29ADFF', // blue
  v: '#83769C', // lavender
  m: '#FF77A8', // pink
  e: '#FFCCAA', // peach
} as const

export type Run = { text: string; color?: string; backgroundColor?: string }

const colorOf = (pixel: string | undefined): string | undefined =>
  pixel === undefined || pixel === '.' ? undefined : (PICO8 as Record<string, string>)[pixel]

/** Turns a grid of palette keys ('.' transparent) into rows of merged runs. */
export const spriteRuns = (grid: readonly string[]): Run[][] => {
  const rows: Run[][] = []
  for (let y = 0; y < grid.length; y += 2) {
    const top = grid[y] ?? ''
    const bottom = grid[y + 1] ?? ''
    const width = Math.max(top.length, bottom.length)
    const runs: Run[] = []
    for (let x = 0; x < width; x += 1) {
      const up = colorOf(top[x])
      const down = colorOf(bottom[x])
      const cell: Run =
        up === undefined && down === undefined
          ? { text: ' ' }
          : up === undefined
            ? { text: '▄', color: down }
            : down === undefined
              ? { text: '▀', color: up }
              : { text: '▀', color: up, backgroundColor: down }
      const last = runs[runs.length - 1]
      if (last && last.text[0] === cell.text && last.color === cell.color && last.backgroundColor === cell.backgroundColor) {
        last.text += cell.text
      } else {
        runs.push(cell)
      }
    }
    rows.push(runs)
  }
  return rows
}

/** A bomb on a tripwire, fuse lit: 12 x 8 pixels, 4 terminal rows. */
export const TRAP_SPRITE = [
  '.......oy...',
  '......d..y..',
  '....rrrr....',
  '...rrwrrrr..',
  '..rrwrrrrpr.',
  '..rrrrrrrpr.',
  '...prrrrpp..',
  'dddddddddddd',
]

/** A small armed-trap icon for the pane header: 6 x 4 pixels, 2 rows. */
export const ARMED_SPRITE = ['..ry..', '.rrrr.', '.rwrp.', 'dddddd']
