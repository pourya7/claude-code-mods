// PICO-8 palette and a tiny half-block sprite renderer: two pixel rows per
// terminal row, the top pixel as the text color, the bottom as the background.

export const PICO8 = {
  k: '#000000', // black
  n: '#1D2B53', // navy
  p: '#7E2553', // plum
  g: '#008751', // green
  b: '#AB5236', // brown (mender's signature)
  d: '#5F574F', // dark grey
  l: '#C2C3C7', // light grey
  w: '#FFF1E8', // white
  r: '#FF004D', // red
  o: '#FFA300', // orange (mender's signature)
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

/** An orange sock with a brown patch, stitched in yellow: 12 x 12 pixels, 6 terminal rows. */
export const SOCK_SPRITE: readonly string[] = [
  '..wwwwww....',
  '..llllll....',
  '..oooooo....',
  '..oooooo....',
  '..obbbbo....',
  '..obybyo....',
  '..obbbbo....',
  '..ooooooo...',
  '..oooooooo..',
  '..ooooooooo.',
  '...ooooooooo',
  '....bbbbbbb.',
]

/** The same sock, grey, when a server is down. */
export const DOWN_SOCK_SPRITE: readonly string[] = SOCK_SPRITE.map(line => line.replace(/[oy]/g, 'd').replace(/[bw]/g, 'l'))
