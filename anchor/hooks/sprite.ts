/** One run of same-styled cells in a sprite row. */
export type SpriteRun = { text: string; color?: string; backgroundColor?: string }

/**
 * Turns a pixel grid (one character per pixel, `.` transparent, others keys
 * of `palette`) into rows of half-block runs: one text row per two pixel rows,
 * `▀` coloured by the top pixel over a background of the bottom one.
 */
export const spriteRows = (grid: readonly string[], palette: Readonly<Record<string, string>>): SpriteRun[][] => {
  const rows: SpriteRun[][] = []
  const width = Math.max(0, ...grid.map(line => line.length))

  for (let y = 0; y < grid.length; y += 2) {
    const runs: SpriteRun[] = []
    for (let x = 0; x < width; x += 1) {
      const top = palette[grid[y]?.[x] ?? '.']
      const bottom = palette[grid[y + 1]?.[x] ?? '.']
      const cell: SpriteRun =
        top && bottom
          ? top === bottom
            ? { text: '█', color: top }
            : { text: '▀', color: top, backgroundColor: bottom }
          : top
            ? { text: '▀', color: top }
            : bottom
              ? { text: '▄', color: bottom }
              : { text: ' ' }
      const last = runs[runs.length - 1]
      if (last && last.color === cell.color && last.backgroundColor === cell.backgroundColor) {
        last.text += cell.text
      } else runs.push(cell)
    }
    rows.push(runs)
  }

  return rows
}
