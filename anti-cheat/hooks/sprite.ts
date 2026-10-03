/** The PICO-8 palette: the only colours the 8-bit family draws with. */
export const PICO8 = {
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

/** One run of same-styled cells: the props of one Text. */
export type SpriteRun = { text: string; color?: string; backgroundColor?: string }

/**
 * Turns a pixel grid (one character per pixel, `.` transparent) into text
 * rows of half blocks: each row holds two pixel rows, the top one drawn as
 * the glyph's colour and the bottom one as its background.
 */
export const spriteRows = (grid: readonly string[], palette: Readonly<Record<string, string>>): SpriteRun[][] => {
  const rows: SpriteRun[][] = []

  for (let y = 0; y < grid.length; y += 2) {
    const top = grid[y] ?? ''
    const bottom = grid[y + 1] ?? ''
    const runs: SpriteRun[] = []

    for (let x = 0; x < Math.max(top.length, bottom.length); x += 1) {
      const upper = palette[top[x] ?? '.']
      const lower = palette[bottom[x] ?? '.']
      const cell: SpriteRun =
        upper && lower
          ? { text: '▀', color: upper, backgroundColor: lower }
          : upper
            ? { text: '▀', color: upper }
            : lower
              ? { text: '▄', color: lower }
              : { text: ' ' }
      const previous = runs[runs.length - 1]

      if (previous && previous.color === cell.color && previous.backgroundColor === cell.backgroundColor) {
        previous.text += cell.text
      } else {
        runs.push(cell)
      }
    }
    rows.push(runs)
  }

  return rows
}
