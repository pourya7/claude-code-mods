// Words radar shows: the model's context note, the status line, the pane's
// rows, and where the memory folders are.
import type { RadarMemory, RadarPing } from '../types'
import type { Match } from './match'

export const expandHome = (path: string, home: string | undefined): string =>
  home !== undefined && (path === '~' || path.startsWith('~/')) ? `${home}${path.slice(1)}` : path

/** `userConfig.memoryDirs`: folders separated by commas or newlines. */
export const memoryDirsOf = (option: unknown, home: string | undefined): string[] =>
  typeof option !== 'string'
    ? []
    : option
        .split(/[,\n]/)
        .map(part => part.trim())
        .filter(part => part !== '')
        .map(part => expandHome(part, home).replace(/(.)\/+$/, '$1'))

/** The engine's folder name for a project: every non-alphanumeric character becomes a dash. */
export const projectSlug = (root: string): string => root.replace(/[^a-zA-Z0-9]/g, '-')

/** autoMemoryDirectory from settings, else <config dir>/projects/<slug>/memory. */
export const defaultMemoryDir = (
  settings: Readonly<Record<string, unknown>>,
  home: string | undefined,
  configDir: string | undefined,
  root: string,
): string => {
  const configured = settings.autoMemoryDirectory
  if (typeof configured === 'string' && configured.trim() !== '') return expandHome(configured.trim(), home)
  const base = configDir !== undefined && configDir !== '' ? configDir : `${home ?? '~'}/.claude`
  return `${base}/projects/${projectSlug(root)}/memory`
}

export const contextText = (memory: RadarMemory, reason: Match['reason'], hits: readonly string[] = []): string => {
  const why = reason === 'trigger' ? 'trigger match' : `keyword match: ${hits.join(', ')}`
  const lines = [`radar: your memory "${memory.name}" (${memory.file}) is about this call (${why}).`, memory.description]
  if (memory.rules.length > 0) lines.push('Rules:', ...memory.rules.map(rule => `- ${rule}`))
  return lines.join('\n')
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 'S'}`

export const statusText = (memories: number, pings: number): string => `RADAR ${memories} ◉ ${plural(pings, 'PING')}`

const two = (value: number) => String(value).padStart(2, '0')

export const clockText = (ms: number): string => {
  const at = new Date(ms)
  return `${two(at.getHours())}:${two(at.getMinutes())}`
}

export const pingText = (ping: RadarPing): string => `${clockText(ping.at)}  ${ping.tool.toUpperCase()}  ${ping.memory}`

/** Newest first. */
export const pingsText = (pings: readonly RadarPing[]): string[] => [...pings].reverse().map(pingText)

export const titleText = (memories: number): string => `RADAR · ${memories} ${memories === 1 ? 'MEMORY' : 'MEMORIES'}`
