// docker: the read-only probes dock runs, their output readers, headroom math
// and compose-up detection. Pure: no `$` here.
import type { DockHealth, DockStack } from '../types'

export const INFO_ARGV = ['docker', 'info', '--format', 'json'] as const
export const COMPOSE_LS_ARGV = ['docker', 'compose', 'ls', '--all', '--format', 'json'] as const
export const PS_ARGV = ['docker', 'ps', '--all', '--no-trunc', '--format', 'json'] as const
export const STATS_ARGV = ['docker', 'stats', '--no-stream', '--format', 'json'] as const

/** Every command dock runs, in the order it runs them. None of them changes anything. */
export const READ_ONLY_ARGVS: readonly (readonly string[])[] = [INFO_ARGV, COMPOSE_LS_ARGV, PS_ARGV, STATS_ARGV]

/** True only for one of dock's own probes, exactly as written. */
export function isReadOnlyArgv(argv: readonly string[]): boolean {
  return READ_ONLY_ARGVS.some(known => known.length === argv.length && known.every((word, index) => argv[index] === word))
}

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Objects from a JSON array, one JSON object, or one JSON object per line (what `--format json` prints). */
export function parseRecords(text: string): Json[] {
  const whole = tryParse(text.trim())
  if (Array.isArray(whole)) return whole.filter(isRecord)
  if (isRecord(whole)) return [whole]
  return text
    .split('\n')
    .map(line => tryParse(line.trim()))
    .filter(isRecord)
}

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
}

/** `1.5GiB`, `512MiB`, `20kB`, or the first half of `1.5GiB / 7.6GiB`, in bytes; null when unreadable. */
export function parseBytes(text: string): number | null {
  const match = /^\s*([\d.]+)\s*([a-z]+)/i.exec(text)
  if (!match) return null
  const value = Number(match[1])
  const unit = UNITS[(match[2] ?? '').toLowerCase()]
  return Number.isFinite(value) && unit !== undefined ? value * unit : null
}

/** `a=1,b=2` into a map; a piece without `=` belongs to the value before it (a comma in a path). */
export function parseLabels(text: string): Record<string, string> {
  const labels: Record<string, string> = {}
  let last: string | null = null
  for (const piece of text.split(',')) {
    const equals = piece.indexOf('=')
    if (equals > 0) {
      last = piece.slice(0, equals)
      labels[last] = piece.slice(equals + 1)
    } else if (last !== null) {
      labels[last] += `,${piece}`
    }
  }
  return labels
}

/** `docker info --format json`: the engine's memory, or the server error when the daemon is down. */
export function readInfo(text: string): { totalBytes: number | null; serverError: string | null } {
  const info = parseRecords(text)[0]
  const errors = info?.ServerErrors
  const serverError = Array.isArray(errors) && errors.length > 0 ? String(errors[0]) : null
  const total = info?.MemTotal
  return { totalBytes: typeof total === 'number' && total > 0 ? total : null, serverError }
}

const STATE_WORDS: Record<string, string> = {
  running: 'UP',
  exited: 'OFF',
  paused: 'PAUSED',
  restarting: 'RESTART',
  created: 'NEW',
  dead: 'DEAD',
  removing: 'GOING',
}

/** Compose's `running(1), exited(1)` as `UP 1 OFF 1`. */
export function stateLabel(status: string): string {
  const parts = [...status.matchAll(/([a-z]+)\((\d+)\)/gi)].map(
    ([, word = '', count = '']) => `${STATE_WORDS[word.toLowerCase()] ?? word.toUpperCase()} ${count}`,
  )
  return parts.length > 0 ? parts.join(' ') : status.trim() === '' ? '?' : status.trim().toUpperCase()
}

function countOf(status: string, word: string): number {
  return [...status.matchAll(/([a-z]+)\((\d+)\)/gi)]
    .filter(([, found]) => found?.toLowerCase() === word)
    .reduce((sum, [, , count]) => sum + Number(count), 0)
}

function totalCount(status: string): number {
  return [...status.matchAll(/\((\d+)\)/g)].reduce((sum, [, count]) => sum + Number(count), 0)
}

function folderOf(path: string): string | null {
  const slash = path.lastIndexOf('/')
  return slash > 0 ? path.slice(0, slash) : slash === 0 ? '/' : null
}

const text = (value: unknown): string => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value))

export type StackRead = { stacks: DockStack[]; usedBytes: number; limitBytes: number | null }

/**
 * Joins `docker compose ls`, `docker ps` and `docker stats` into one row per
 * compose project: its working dir (label, else the compose file's folder),
 * state, and the memory its running containers use. Biggest first.
 */
export function readStacks(lsText: string, psText: string, statsText: string): StackRead {
  const containers = parseRecords(psText).map(row => {
    const labels = parseLabels(text(row.Labels))
    return {
      id: text(row.ID),
      names: text(row.Names).split(','),
      project: labels['com.docker.compose.project'] ?? null,
      workingDir: labels['com.docker.compose.project.working_dir'] ?? null,
    }
  })

  const memory = new Map<string, number>()
  let usedBytes = 0
  let limitBytes: number | null = null
  for (const row of parseRecords(statsText)) {
    const usage = text(row.MemUsage)
    const used = parseBytes(usage) ?? 0
    usedBytes += used
    const limit = usage.includes('/') ? parseBytes(usage.slice(usage.indexOf('/') + 1)) : null
    if (limitBytes === null && limit !== null && limit > 0) limitBytes = limit
    const name = text(row.Name)
    const id = text(row.ID || row.Container)
    const owner =
      containers.find(container => container.names.includes(name)) ??
      (id === '' ? undefined : containers.find(container => container.id.startsWith(id) || id.startsWith(container.id)))
    if (owner?.project) memory.set(owner.project, (memory.get(owner.project) ?? 0) + used)
  }

  const stacks: DockStack[] = parseRecords(lsText).map(row => {
    const name = text(row.Name)
    const status = text(row.Status)
    const labelled = containers.find(container => container.project === name && container.workingDir)?.workingDir ?? null
    const configFile = text(row.ConfigFiles).split(',')[0]?.trim() ?? ''
    return {
      name,
      workingDir: labelled ?? (configFile === '' ? null : folderOf(configFile)),
      isOrphan: false,
      stateLabel: stateLabel(status),
      isRunning: countOf(status, 'running') > 0,
      containers: totalCount(status),
      memoryBytes: memory.get(name) ?? 0,
    }
  })
  stacks.sort((a, b) => b.memoryBytes - a.memoryBytes || a.name.localeCompare(b.name))

  return { stacks, usedBytes, limitBytes }
}

/** Marks the stacks whose (known) working dir is in `missingDirs`. */
export function markOrphans(stacks: readonly DockStack[], missingDirs: ReadonlySet<string>): DockStack[] {
  return stacks.map(stack => ({ ...stack, isOrphan: stack.workingDir !== null && missingDirs.has(stack.workingDir) }))
}

/** Free engine memory in bytes: total minus what every container uses, never below zero. */
export function headroomBytes(memory: { totalBytes: number; usedBytes: number }): number {
  return Math.max(0, memory.totalBytes - memory.usedBytes)
}

/** The running stacks using the most memory, biggest first. */
export function biggestStacks(stacks: readonly DockStack[], count: number): DockStack[] {
  return stacks
    .filter(stack => stack.isRunning && stack.memoryBytes > 0)
    .sort((a, b) => b.memoryBytes - a.memoryBytes)
    .slice(0, count)
}

const DOCKER_VALUE_FLAGS = new Set(['-c', '--context', '-H', '--host', '--config', '-l', '--log-level', '--tlscacert', '--tlscert', '--tlskey'])
const COMPOSE_VALUE_FLAGS = new Set([
  '-f',
  '--file',
  '-p',
  '--project-name',
  '--project-directory',
  '--env-file',
  '--profile',
  '--ansi',
  '--parallel',
  '--progress',
])

const unquote = (word: string) => word.replace(/^['"]|['"]$/g, '')

/** The compose subcommand after `compose`'s own flags, or null. */
function composeVerb(words: readonly string[], from: number): string | null {
  for (let index = from; index < words.length; index += 1) {
    const word = words[index] ?? ''
    if (!word.startsWith('-')) return word
    if (!word.includes('=') && COMPOSE_VALUE_FLAGS.has(word)) index += 1
  }
  return null
}

/** True when one simple command boots a compose stack. */
function segmentIsUp(segment: string): boolean {
  const words = segment.trim().split(/\s+/).filter(Boolean).map(unquote)
  // The program is the first word after env assignments and sudo/env/command wrappers.
  let start = 0
  while (start < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[start] ?? '') || ['sudo', 'env', 'command', 'exec'].includes(words[start] ?? ''))) {
    start += 1
  }
  const program = words[start]
  if (program === 'docker-compose') return composeVerb(words, start + 1) === 'up'
  if (program !== 'docker') return false
  for (let index = start + 1; index < words.length; index += 1) {
    const word = words[index] ?? ''
    if (word === 'compose') return composeVerb(words, index + 1) === 'up'
    if (!word.startsWith('-')) return false
    if (!word.includes('=') && DOCKER_VALUE_FLAGS.has(word)) index += 1
  }
  return false
}

/** True when a Bash command runs `docker compose up` or `docker-compose up` anywhere in it. */
export function isComposeUp(command: string): boolean {
  return command.split(/&&|\|\||[;|&\n()]/).some(segmentIsUp)
}

const SAFE_WORD = /^[A-Za-z0-9_.-]+$/

/** The exact command that stops and removes one stack, for the person to run. dock never runs it. */
export function downCommand(project: string): string {
  const quoted = SAFE_WORD.test(project) ? project : `'${project.replace(/'/g, `'\\''`)}'`
  return `docker compose -p ${quoted} down`
}

const DAEMON_DOWN = /cannot connect to the docker daemon|is the docker daemon running|error during connect|docker daemon is not running|docker\.sock/i

/** A docker run that exited non-zero, as a health and one line. */
export function describeDockerFailure(stderr: string): { health: DockHealth; message: string } {
  const first = stderr.trim().split('\n')[0]?.trim() ?? ''
  if (DAEMON_DOWN.test(stderr)) return { health: 'daemon-down', message: first }
  return { health: 'error', message: first === '' ? 'docker failed with no message' : first.slice(0, 200) }
}
