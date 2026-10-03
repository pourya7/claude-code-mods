// Deterministic matching of a tool call against the memory index: explicit
// trigger regexes first, then overlap of distinctive keywords.
import type { RadarMemory } from '../types'
import type { ParsedMemory } from './memory'

export type Match = {
  memory: RadarMemory
  reason: 'trigger' | 'keywords'
  /** The shared keywords, in the call's order (empty for a trigger). */
  hits: string[]
}

export const MAX_PER_CALL = 2
const MIN_SHARED = 2
const MAX_CALL_TEXT = 4000

const STOP_WORDS = new Set(
  (
    'the and for with that this from into are was were has have had not but you your our its can will would should ' +
    'could use used using uses when then than what which who how why all any each every one two new old get set run ' +
    'runs ran make made does did done just only also more most very like out over after before about there here them ' +
    'they their these those some such own same other via per too may might must never always dont don do does ask ' +
    'first last file files thing things way ways need needs want wants keep kept see note notes memory memories rule ' +
    'rules true false null none yes because while still even ever again back down off now yet well good bad know ' +
    'http https www com org net mcp dev tmp usr bin var etc home users user'
  ).split(' '),
)

/** Folds a plain plural ("worktrees") onto its singular; leaves "glass" alone. */
const stem = (word: string): string => (word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)

export const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length >= 3 && !/^\d+$/.test(word) && !STOP_WORDS.has(word))
    .map(stem)
    .filter(word => !STOP_WORDS.has(word))

const PATH_KEYS = ['file_path', 'notebook_path', 'path', 'url', 'query', 'pattern'] as const

const stringsOf = (value: unknown, out: string[]): void => {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const item of value) stringsOf(item, out)
  else if (typeof value === 'object' && value !== null) for (const item of Object.values(value)) stringsOf(item, out)
}

/**
 * What a call is about: Bash's command, a file path, a URL, an MCP tool's name
 * and string arguments. Always cut to MAX_CALL_TEXT, so a long command cannot
 * make the trigger regexes slow.
 */
export const callText = (tool: string, args: Readonly<Record<string, unknown>>): string => {
  if (tool === 'Bash' || tool === 'PowerShell') return typeof args.command === 'string' ? args.command.slice(0, MAX_CALL_TEXT) : ''
  if (tool.startsWith('mcp__')) {
    const parts = [tool]
    stringsOf(args, parts)
    return parts.join('\n').slice(0, MAX_CALL_TEXT)
  }
  const parts = PATH_KEYS.map(key => args[key]).filter((value): value is string => typeof value === 'string')
  return parts.join('\n').slice(0, MAX_CALL_TEXT)
}

/**
 * Turns parsed memories into the index: each keeps the tokens of its name and
 * description that at most max(3, 10%) of the memories share, so a word
 * every memory uses never counts as a match.
 */
export const buildIndex = (memories: readonly ParsedMemory[]): RadarMemory[] => {
  const tokensOf = memories.map(memory => [...new Set(tokenize(`${memory.name} ${memory.description}`))])
  const frequency = new Map<string, number>()
  for (const tokens of tokensOf) for (const token of tokens) frequency.set(token, (frequency.get(token) ?? 0) + 1)
  const limit = Math.max(3, Math.ceil(memories.length / 10))
  return memories.map((memory, i) => ({
    ...memory,
    keywords: (tokensOf[i] ?? []).filter(token => (frequency.get(token) ?? 0) <= limit),
  }))
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Whether the call reads or writes inside one of the indexed memory folders
 * (absolute, or `~/...` when the folder is under `home`). Such a call is
 * about the memory files themselves, so nothing is matched against it.
 */
export const touchesSources = (text: string, dirs: readonly string[], home: string | undefined): boolean =>
  dirs.some(dir => {
    const forms = [dir]
    if (home !== undefined && home !== '' && dir.startsWith(`${home}/`)) forms.push(`~${dir.slice(home.length)}`)
    return forms.some(form => new RegExp(`(?<![\\w.~/-])${escapeRegex(form)}(?=$|[/\\s'"\`])`).test(text))
  })

const triggerHit = (memory: RadarMemory, text: string): boolean =>
  memory.triggers.some(source => {
    try {
      return new RegExp(source, 'i').test(text)
    } catch {
      return false
    }
  })

/** The memories this call is about, best first, at most `limit`, skipping `exclude`d files. */
export const findMatches = (
  index: readonly RadarMemory[],
  text: string,
  exclude: readonly string[],
  limit = MAX_PER_CALL,
): Match[] => {
  if (text.trim() === '') return []
  const open = index.filter(memory => !exclude.includes(memory.file))
  const triggered: Match[] = open.filter(memory => triggerHit(memory, text)).map(memory => ({ memory, reason: 'trigger', hits: [] }))
  const callTokens = [...new Set(tokenize(text))]
  const scored = open
    .filter(memory => !triggered.some(hit => hit.memory.file === memory.file))
    .map((memory, order) => ({ memory, order, hits: callTokens.filter(token => memory.keywords.includes(token)) }))
    .filter(entry => entry.hits.length >= MIN_SHARED)
    .sort((a, b) => b.hits.length - a.hits.length || a.order - b.order)
    .map((entry): Match => ({ memory: entry.memory, reason: 'keywords', hits: entry.hits }))
  return [...triggered, ...scored].slice(0, limit)
}
