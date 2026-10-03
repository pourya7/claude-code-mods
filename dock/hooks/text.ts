// text: what dock says in words, for the guard's ask, the /dock reply and
// the pane. Pure: no `$` here.
import type { DockSnapshot } from '../types'
import { biggestStacks, downCommand, headroomBytes } from './docker'

const GIB = 1024 ** 3

/** Bytes as GiB with one decimal: `2.5`. */
export function gib(bytes: number): string {
  return (bytes / GIB).toFixed(1)
}

/** True when docker was read and the headroom is under `minGiB`. */
export function isLowFuel(snapshot: DockSnapshot, minGiB: number): boolean {
  return snapshot.health === 'ok' && headroomBytes(snapshot) < minGiB * GIB
}

/** The ask the guard puts to the person before another stack boots. */
export function guardReason(snapshot: DockSnapshot, minGiB: number): string {
  const biggest = biggestStacks(snapshot.stacks, 3)
  const named = biggest.map(stack => `${stack.name} ${gib(stack.memoryBytes)} GiB${stack.isOrphan ? ' (ORPHAN)' : ''}`)
  const first = biggest.find(stack => stack.isOrphan) ?? biggest[0]
  return [
    `DOCK: LOW FUEL. Only ${gib(headroomBytes(snapshot))} GiB free of ${gib(snapshot.totalBytes)} GiB; the minimum before booting another stack is ${minGiB} GiB.`,
    named.length > 0 ? `Biggest stacks: ${named.join(', ')}.` : 'No compose stack holds much memory; something else does.',
    first ? `To free memory first: ${downCommand(first.name)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Why docker could not be read, as an arcade line. */
export function offlineLine(snapshot: DockSnapshot): string {
  if (snapshot.health === 'no-docker') return 'NO DOCKER FOUND. INSTALL IT OR PUT IT ON PATH'
  if (snapshot.health === 'daemon-down') return 'DOCKER DAEMON DOWN. START DOCKER, THEN RESCAN'
  return `DOCKER ERROR: ${snapshot.message}`
}

/** The `/dock` reply: the same facts as the pane, as plain text. */
export function summaryText(snapshot: DockSnapshot, minGiB: number): string {
  if (snapshot.health !== 'ok') return `DOCK: ${offlineLine(snapshot)}`
  const headroom = gib(headroomBytes(snapshot))
  const fuel = isLowFuel(snapshot, minGiB) ? `. LOW FUEL (under ${minGiB} GiB).` : '.'
  const lines = [`DOCK: ${gib(snapshot.usedBytes)} of ${gib(snapshot.totalBytes)} GiB used, ${headroom} GiB headroom${fuel}`]
  if (snapshot.stacks.length === 0) return [...lines, 'NO STACKS. Nothing from docker compose is here.'].join('\n')
  const nameWidth = Math.max(...snapshot.stacks.map(stack => stack.name.length))
  const stateWidth = Math.max(...snapshot.stacks.map(stack => stack.stateLabel.length))
  for (const stack of snapshot.stacks) {
    const where = stack.isOrphan ? `ORPHAN (${stack.workingDir} is gone)` : (stack.workingDir ?? '?')
    lines.push(`${stack.name.padEnd(nameWidth)}  ${stack.stateLabel.padEnd(stateWidth)}  ${gib(stack.memoryBytes).padStart(5)} GiB  ${where}`)
  }
  const orphan = snapshot.stacks.find(stack => stack.isOrphan && stack.isRunning)
  if (orphan) lines.push(`Free an orphan: ${downCommand(orphan.name)}`)
  return lines.join('\n')
}

/** A path cut to `width` columns, keeping its tail. */
export function shortenPath(path: string, width: number): string {
  if (path.length <= width) return path
  return `..${path.slice(path.length - Math.max(0, width - 2))}`
}

/** True when the session works in this working dir (or below it). */
export function isHere(workingDir: string | null, cwd: string): boolean {
  if (workingDir === null || cwd === '') return false
  return cwd === workingDir || cwd.startsWith(`${workingDir.replace(/\/$/, '')}/`)
}

/**
 * The working dir the session was booted from: of the dirs that hold the cwd,
 * the deepest. A worktree nested in its main checkout picks the worktree, not both.
 */
export function hereDir(workingDirs: readonly (string | null)[], cwd: string): string | null {
  let best: string | null = null
  for (const dir of workingDirs) {
    if (dir !== null && isHere(dir, cwd) && (best === null || dir.length > best.length)) best = dir
  }
  return best
}
