/**
 * Half-block pixel art: a sprite is a grid of palette keys ('.' is
 * transparent); two pixel rows fold into one text row, the top pixel as the
 * `▀`'s color and the bottom one as its background.
 */

/** PICO-8, keyed by one letter. */
export const PALETTE = {
  k: '#000000', // black
  n: '#1D2B53', // navy: dock's signature, with blue
  m: '#7E2553', // plum
  g: '#008751', // green
  b: '#AB5236', // brown
  d: '#5F574F', // dark grey
  l: '#C2C3C7', // light grey
  w: '#FFF1E8', // white
  r: '#FF004D', // red
  o: '#FFA300', // orange
  y: '#FFEC27', // yellow
  e: '#00E436', // lime
  u: '#29ADFF', // blue: dock's signature, with navy
  v: '#83769C', // lavender
  i: '#FF77A8', // pink
  c: '#FFCCAA', // peach
} as const

export type PaletteKey = keyof typeof PALETTE

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

/** A harbour crane lifting an orange container onto a blue stack: 12x6, 3 text rows. */
export const CRANE: readonly string[] = [
  'nnnnnnnnnnnn',
  '.nn.....l...',
  '.n.n...ooo..',
  '.n.....ooo..',
  '.n.uuu.uuu..',
  'nnnnnnnnnnnn',
]

/** The darker pixel under each lit one, so a bar reads as lit top, shadow bottom. */
const SHADE: Partial<Record<PaletteKey, PaletteKey>> = { u: 'n', r: 'm', o: 'b', e: 'g', l: 'd' }

const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))

/**
 * The fuel gauge: two pixel rows, `width` wide, filled by `used` (0..1 of the
 * engine). The red line sits where headroom runs low (`redLine`, 0..1); a
 * fill past it turns red.
 */
export const gaugeGrid = (used: number, redLine: number, width: number): string[] => {
  const filled = Math.round(clamp(used) * width)
  const isPast = clamp(used) > clamp(redLine)
  const lit: PaletteKey = isPast ? 'r' : 'u'
  const marker = Math.min(width - 1, Math.max(0, Math.round(clamp(redLine) * width) - 1))
  let top = ''
  let bottom = ''
  for (let x = 0; x < width; x += 1) {
    const isFilled = x < filled
    top += isFilled ? lit : 'd'
    bottom += isFilled ? (SHADE[lit] ?? lit) : x === marker ? 'r' : 'k'
  }
  return [top, bottom]
}

/** One stack's share of the engine as a small bar; any memory at all lights one pixel. */
export const barGrid = (share: number, width: number, lit: PaletteKey = 'u'): string[] => {
  const value = clamp(share)
  const filled = value > 0 ? Math.max(1, Math.round(value * width)) : 0
  const shade = SHADE[lit] ?? lit
  return ['', ''].map((_, row) =>
    Array.from({ length: width }, (_unused, x) => (x < filled ? (row === 0 ? lit : shade) : row === 0 ? 'd' : 'k')).join(''),
  )
}
