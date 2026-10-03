import type { AnchorPoint } from '../types'
import { shellQuote } from './shell'

/** The status line glyph: single-width, unlike the anchor emoji. */
export const GLYPH = '╋'

/** Most columns the status line takes. */
export const STATUS_COLUMNS = 40

/** `╋ ANCHOR <worktree>@<branch>`, cut to fit the status line. */
export const statusText = ({ name, branch }: Pick<AnchorPoint, 'name' | 'branch'>): string => {
  const text = `${GLYPH} ANCHOR ${name}${branch ? `@${branch}` : ''}`

  return text.length > STATUS_COLUMNS ? `${text.slice(0, STATUS_COLUMNS - 1)}…` : text
}

/** The anchor sprite: a 10x10 pixel grid, 5 terminal rows. */
export const ANCHOR_SPRITE = [
  '....ww....',
  '...w..w...',
  '....ww....',
  '..bbbbbb..',
  '....bb....',
  '....bb....',
  'b...bb...b',
  'bb..bb..bb',
  '.bbbbbbbb.',
  '...nbbn...',
] as const

/** PICO-8 colours: white ring, blue body (anchor's signature), navy shade. */
export const SPRITE_PALETTE = { w: '#FFF1E8', b: '#29ADFF', n: '#1D2B53' } as const

/** The same sprite greyed out while the anchor is off. */
export const SPRITE_PALETTE_OFF = { w: '#C2C3C7', b: '#5F574F', n: '#5F574F' } as const

/** Signature colour for labels. */
export const BLUE = '#29ADFF'

/** The `/anchor` reply: a title line, then `LABEL  value` lines. */
export const replyLines = (point: AnchorPoint | null, isGuarded: boolean): string[] => {
  if (!point) return [`${GLYPH} ANCHOR NONE`, 'SET     /anchor <path>']
  if (!point.isOn) {
    return [`${GLYPH} ANCHOR OFF  pass-through`, `LAST    ${point.path}`, 'ON      /anchor on  or  /anchor <path>']
  }
  const where = `${point.name}${point.branch ? `@${point.branch}` : ''}`
  const lines = [`${GLYPH} ANCHOR SET  ${where}`, `ANCHOR  ${point.path}`]
  if (point.primary) lines.push(`PRIMARY ${point.primary}  ${isGuarded ? 'GUARDED' : 'OPEN'}`)
  lines.push(`BASH    cd ${shellQuote(point.path)} && ...`, 'OFF     /anchor off')

  return lines
}

/** Splits a reply line into its label and value at the first run of spaces. */
export const splitLine = (line: string): { label: string; value: string } => {
  const match = /^(\S+)\s+(.*)$/.exec(line)

  return match ? { label: match[1] as string, value: match[2] as string } : { label: line, value: '' }
}
