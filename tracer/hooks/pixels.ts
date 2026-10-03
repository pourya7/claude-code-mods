// Pixel art: the PICO-8 palette, the level-map nodes and a half-block renderer.
import type { TracerStage } from '../types'
import { GLYPH, cleanName, currentStage } from './chain'

export const PICO = {
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

/** tracer's signature colour. */
export const SIGNATURE = PICO.yellow

const KEYS: Record<string, string> = {
  k: PICO.black,
  y: PICO.yellow,
  w: PICO.white,
  r: PICO.red,
  b: PICO.blue,
  d: PICO.darkGrey,
  o: PICO.orange,
}

/** Map nodes, 6 x 4 pixels (2 terminal rows). `.` is transparent. */
const NODE = {
  // A coin with a shine: a stage cleared.
  done: ['.yyyy.', 'yywwyy', 'yyyyyy', '.yyyy.'],
  // An empty ring: a stage still ahead.
  pending: ['.dddd.', 'dd..dd', 'dd..dd', '.dddd.'],
  // The player: the stage tracer is waiting on now.
  current: ['.bbbb.', 'bbwwbb', 'bbwwbb', '.bbbb.'],
  // A red cross: the stage failed.
  failed: ['rr..rr', '.rrrr.', '.rrrr.', 'rr..rr'],
} as const

const NODE_WIDTH = 6

/** One run of same-styled cells in a terminal row. */
export type PixelRun = { text: string; color?: string; backgroundColor?: string }

/**
 * Two pixel rows per terminal row: `▀` with the top pixel as `color` and the
 * bottom as `backgroundColor`; `▄` when only the bottom is set; a space when
 * neither. Adjacent cells with the same style merge into one run.
 */
export function halfBlockRows(grid: readonly string[]): PixelRun[][] {
  const width = Math.max(0, ...grid.map(line => line.length))
  const rows: PixelRun[][] = []
  for (let top = 0; top < grid.length; top += 2) {
    const runs: PixelRun[] = []
    for (let column = 0; column < width; column += 1) {
      const upper = KEYS[grid[top]?.[column] ?? '.']
      const lower = KEYS[grid[top + 1]?.[column] ?? '.']
      const cell: PixelRun =
        upper !== undefined
          ? lower !== undefined
            ? { text: '▀', color: upper, backgroundColor: lower }
            : { text: '▀', color: upper }
          : lower !== undefined
            ? { text: '▄', color: lower }
            : { text: ' ' }
      const last = runs[runs.length - 1]
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

type Look = keyof typeof NODE

function lookOf(stage: TracerStage, current: TracerStage | undefined, isTracing: boolean): Look {
  if (stage.state === 'done') return 'done'
  if (stage.state === 'failed') return 'failed'
  return isTracing && stage === current ? 'current' : 'pending'
}

const LABEL_COLOR: Record<Look, string> = {
  done: PICO.yellow,
  failed: PICO.red,
  current: PICO.blue,
  pending: PICO.lightGrey,
}

function center(text: string, width: number): string {
  const left = Math.floor((width - text.length) / 2)
  return `${' '.repeat(left)}${text}`.padEnd(width)
}

function environmentTag(stage: TracerStage): string {
  if (stage.kind !== 'deploy') return ''
  const name = cleanName(stage.environment ?? '').toUpperCase()
  return name.length > 8 ? `${name.slice(0, 7)}~` : name
}

export type LabelCell = { text: string; color: string }

/** One node to draw: a stage, or every deploy stage folded into one. */
type MapNode = { state: TracerStage['state']; look: Look; kind: string; tag: string }

function nodeOf(stage: TracerStage, current: TracerStage | undefined, isTracing: boolean): MapNode {
  const kind = `${GLYPH[stage.state]} ${stage.kind === 'deploy' ? 'DEPLOY' : stage.kind.toUpperCase()}`
  return { state: stage.state, look: lookOf(stage, current, isTracing), kind, tag: environmentTag(stage) }
}

/** Every DEPLOY node folded into one `DEPLOY` node tagged `2/5` (environments done of all). */
function foldedNodes(stages: readonly TracerStage[], current: TracerStage | undefined, isTracing: boolean): MapNode[] {
  const deploys = stages.filter(stage => stage.kind === 'deploy')
  if (deploys.length < 2) return stages.map(stage => nodeOf(stage, current, isTracing))
  const state: TracerStage['state'] = deploys.some(stage => stage.state === 'failed')
    ? 'failed'
    : deploys.every(stage => stage.state === 'done')
      ? 'done'
      : 'pending'
  const look: Look = state !== 'pending' ? state : isTracing && current?.kind === 'deploy' ? 'current' : 'pending'
  const done = deploys.filter(stage => stage.state === 'done').length
  const folded: MapNode = { state, look, kind: `${GLYPH[state]} DEPLOY`, tag: `${done}/${deploys.length}` }
  const nodes: MapNode[] = []
  for (const stage of stages) {
    if (stage.kind !== 'deploy') nodes.push(nodeOf(stage, current, isTracing))
    else if (stage === deploys[0]) nodes.push(folded)
  }
  return nodes
}

function nodeWidth(node: MapNode): number {
  return Math.max(NODE_WIDTH, node.kind.length, node.tag.length) + 2
}

function mapWidth(nodes: readonly MapNode[]): number {
  return nodes.reduce((sum, node) => sum + nodeWidth(node), 0)
}

/**
 * The level map: one node per stage joined by a dotted path (orange where it
 * has been travelled), two terminal rows of half-block pixels, then a row of
 * `★ BUILD`-style labels and a row of deploy environment names.
 *
 * Wider than `maxColumns`, the deploy nodes fold into one `DEPLOY 2/5` node;
 * still wider, there is no map (the per-stage lines below it carry it all).
 */
export function levelMap(
  stages: readonly TracerStage[],
  isTracing: boolean,
  maxColumns = Number.POSITIVE_INFINITY,
): { pixels: PixelRun[][]; labels: LabelCell[][] } {
  const current = currentStage(stages)
  let nodes = stages.map(stage => nodeOf(stage, current, isTracing))
  if (mapWidth(nodes) > maxColumns) nodes = foldedNodes(stages, current, isTracing)
  if (mapWidth(nodes) > maxColumns) return { pixels: [], labels: [] }
  const columns = nodes.map(node => ({ ...node, width: nodeWidth(node) }))
  const total = mapWidth(nodes)
  const grid = [0, 1, 2, 3].map(() => Array.from({ length: total }, () => '.'))
  let left = 0
  let previousRight = -1
  columns.forEach(column => {
    const start = left + Math.floor((column.width - NODE_WIDTH) / 2)
    if (previousRight >= 0) {
      const road = column.state === 'done' ? 'o' : 'd'
      // A dotted path at the nodes' waist, one pixel every other column.
      for (let x = previousRight + 1; x < start - 1; x += 2) grid[2]![x] = road
    }
    NODE[column.look].forEach((line, row) => {
      for (let x = 0; x < NODE_WIDTH; x += 1) grid[row]![start + x] = line[x] ?? '.'
    })
    previousRight = start + NODE_WIDTH
    left += column.width
  })
  return {
    pixels: halfBlockRows(grid.map(row => row.join(''))),
    labels: [
      columns.map(column => ({ text: center(column.kind, column.width), color: LABEL_COLOR[column.look] })),
      columns.map(column => ({ text: center(column.tag, column.width), color: LABEL_COLOR[column.look] })),
    ],
  }
}

/** The plain-text capture of the map (what a monochrome terminal shows). */
export function plainMap(stages: readonly TracerStage[], isTracing: boolean, maxColumns = Number.POSITIVE_INFINITY): string[] {
  const map = levelMap(stages, isTracing, maxColumns)
  return [...map.pixels, ...map.labels].map(runs => runs.map(run => run.text).join(''))
}
