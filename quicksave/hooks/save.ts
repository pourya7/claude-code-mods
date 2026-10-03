/**
 * quicksave's pure logic: the prompt that asks for a save, reading the reply,
 * the slot list, and the text the model reads back after a compaction.
 */

export const PLUGIN = 'quicksave'

/** How many saves are kept per session. */
export const MAX_SLOTS = 5

/** The first words of every note quicksave hands the model; also how a note already present is recognised. */
export const NOTE_MARKER = 'QUICKSAVE'

export type Save = {
  goal: string
  step: string
  cwd: string
  branch: string
  links: string[]
  decisions: string[]
  rules: string[]
  next: string
  /** The reply's own words, kept when it was not readable JSON. */
  notes?: string
}

export type Slot = {
  /** When it was saved, in ms since the epoch. */
  at: number
  /** What made it: a compaction trigger (`manual`, `auto`, `plugin`), `command` or `band`. */
  trigger: string
  save: Save
}

export const SAVE_PROMPT = [
  'QUICKSAVE: the conversation is about to be compacted. Write a save point so the work can continue from it afterwards.',
  'Reply with one JSON object and nothing else, with exactly these keys:',
  '{',
  '  "goal": "the overall task, in one sentence",',
  '  "step": "what is being done right now",',
  '  "cwd": "the working directory",',
  '  "branch": "the git branch, or empty",',
  '  "links": ["every open PR, ticket, URL or file path mentioned that still matters"],',
  '  "decisions": ["each decision made so far, with its reason"],',
  '  "rules": ["each rule or preference the user set in this session, in their words"],',
  '  "next": "the very next step"',
  '}',
  'Use only what this conversation says. Leave a field empty rather than guess. Call no tools.',
].join('\n')

const MAX_FIELD = 2_000
const MAX_ITEMS = 30

const clip = (text: string): string => (text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD)}…` : text)

const asText = (value: unknown): string => (typeof value === 'string' ? clip(value.trim()) : '')

const asList = (value: unknown): string[] => {
  if (typeof value === 'string') return value.trim() === '' ? [] : [clip(value.trim())]
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map(item => clip(item.trim()))
    .slice(0, MAX_ITEMS)
}

const EMPTY_SAVE: Save = { goal: '', step: '', cwd: '', branch: '', links: [], decisions: [], rules: [], next: '' }

/** The first `{ ... }` object in the text that parses, or undefined. */
const firstObject = (text: string): Record<string, unknown> | undefined => {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    for (let end = text.lastIndexOf('}'); end > start; end = text.lastIndexOf('}', end - 1)) {
      try {
        const value: unknown = JSON.parse(text.slice(start, end + 1))
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
      } catch {
        // a shorter span may parse
      }
    }
  }
  return undefined
}

/** Reads the model's reply as a save; a reply that is not JSON is kept whole as `notes`. */
export const parseSave = (text: string): Save => {
  const object = firstObject(text)
  if (object === undefined) return { ...EMPTY_SAVE, notes: clip(text.trim()) }
  return {
    goal: asText(object.goal),
    step: asText(object.step),
    cwd: asText(object.cwd),
    branch: asText(object.branch),
    links: asList(object.links),
    decisions: asList(object.decisions),
    rules: asList(object.rules),
    next: asText(object.next),
  }
}

/** Puts a slot first and keeps the newest `cap`. */
export const pushSlot = (slots: readonly Slot[], slot: Slot, cap = MAX_SLOTS): Slot[] => [slot, ...slots].slice(0, cap)

/** How many sessions keep their slots in the store; older sessions' slots are removed. */
export const MAX_SESSIONS = 20

/** Moves a session id to the front of the kept list; answers the list to keep and the ids to drop. */
export const touchSession = (ids: unknown, id: string, cap = MAX_SESSIONS): { keep: string[]; drop: string[] } => {
  const known = Array.isArray(ids) ? ids.filter((item): item is string => typeof item === 'string' && item !== id) : []
  const all = [id, ...known]
  return { keep: all.slice(0, cap), drop: all.slice(cap) }
}

/** Reads stored slots, dropping anything that is not one. */
export const readSlots = (value: unknown): Slot[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Slot =>
          item !== null && typeof item === 'object' && typeof item.at === 'number' && typeof item.save === 'object',
      )
    : []

/** `/quickload [n]`: 1 is the newest; empty means 1. */
export const pickSlot = (slots: readonly Slot[], argument: string): Slot | undefined => {
  const word = argument.trim()
  if (word === '') return slots[0]
  if (!/^\d+$/.test(word)) return undefined
  return slots[Number(word) - 1]
}

/** `2026-10-03 12:04`, in UTC so it reads the same everywhere. */
export const stamp = (at: number): string => new Date(at).toISOString().slice(0, 16).replace('T', ' ')

const headline = (save: Save): string => save.goal || save.step || (save.notes ?? '').split('\n')[0] || '(no goal recorded)'

/** `/quicksave list`. */
export const slotList = (slots: readonly Slot[]): string => {
  if (slots.length === 0) return 'QUICKSAVE ▸ NO SAVES YET. /quicksave makes one now.'
  const lines = slots.map((slot, index) => {
    const mark = index === 0 ? '★' : '●'
    const words = headline(slot.save)
    const short = words.length > 60 ? `${words.slice(0, 59)}…` : words
    return `${index + 1} ${mark} ${stamp(slot.at)} ${slot.trigger.toUpperCase()}  ${short}`
  })
  return ['QUICKSAVE ▸ SLOTS (newest first)', ...lines, '/quickload [n] hands slot n back to the model.'].join('\n')
}

const listSection = (title: string, items: readonly string[]): string[] =>
  items.length === 0 ? [] : [`${title}:`, ...items.map(item => `- ${item}`)]

const lineSection = (title: string, text: string): string[] => (text === '' ? [] : [`${title}: ${text}`])

/** The user-role note the model reads after a compaction or `/quickload`. */
export const saveNote = (slot: Slot, number: number): string => {
  const { save } = slot
  const place = save.cwd === '' ? '' : save.branch === '' ? save.cwd : `${save.cwd} (branch ${save.branch})`
  return [
    `${NOTE_MARKER} (slot ${number}, saved ${stamp(slot.at)} UTC, ${slot.trigger}). This is the save point written before the conversation was compacted. Continue the task from it; the user's rules below still apply.`,
    ...lineSection('GOAL', save.goal),
    ...lineSection('CURRENT STEP', save.step),
    ...lineSection('WORKING DIRECTORY', place || save.branch),
    ...listSection('OPEN LINKS', save.links),
    ...listSection('DECISIONS', save.decisions),
    ...listSection('RULES THE USER SET', save.rules),
    ...lineSection('NEXT STEP', save.next),
    ...(save.notes ? ['NOTES:', save.notes] : []),
  ].join('\n')
}

/** A note `saveNote` wrote: the marker followed by its `(slot n, saved ...` header, not any text that merely starts with the word. */
export const isSaveNote = (text: string): boolean => new RegExp(`^${NOTE_MARKER} \\(slot \\d+, saved `).test(text)

const mdList = (title: string, items: readonly string[]): string[] =>
  items.length === 0 ? [] : ['', `## ${title}`, ...items.map(item => `- ${item}`)]

const mdLine = (title: string, text: string): string[] => (text === '' ? [] : ['', `## ${title}`, text])

/** The mirror written when `writeFile` is on. */
export const saveMarkdown = (slot: Slot, sessionId: string): string => {
  const { save } = slot
  return [
    `# Quicksave ${sessionId}`,
    '',
    `Saved ${stamp(slot.at)} UTC (${slot.trigger}).`,
    ...mdLine('Goal', save.goal),
    ...mdLine('Current step', save.step),
    ...mdLine('Working directory', save.cwd),
    ...mdLine('Branch', save.branch),
    ...mdList('Open links', save.links),
    ...mdList('Decisions', save.decisions),
    ...mdList('Rules the user set', save.rules),
    ...mdLine('Next step', save.next),
    ...mdLine('Notes', save.notes ?? ''),
    '',
  ].join('\n')
}

type Message = { role: 'user' | 'assistant'; text: string; toolUses: readonly unknown[] }

/**
 * The compacted conversation with this save as its last user message. Any
 * earlier save note the compaction kept (an older compaction's, or a
 * `/quickload` of an older slot) is dropped, so the model continues from this
 * save and reads exactly one.
 */
export const withNote = <M extends Message>(messages: readonly M[], note: string): (M | Message)[] => [
  ...messages.filter(message => !(message.role === 'user' && isSaveNote(message.text))),
  { role: 'user', text: note, toolUses: [] },
]

/** The compaction instructions `[ SAVE + COMPACT ]` passes, so the summary keeps the save too. */
export const compactInstructions = (note: string): string =>
  `Keep this save point in the summary, word for word where you can:\n${note}`

export type BandInputs = { percent: number | undefined; threshold: number; isWorking: boolean; runningAgents: number }

/** The save-point band: at or above the threshold, no turn running, no background agent running. */
export const shouldShowBand = ({ percent, threshold, isWorking, runningAgents }: BandInputs): boolean =>
  percent !== undefined && percent >= threshold && !isWorking && runningAgents === 0

export const percentOption = (configured: unknown): number =>
  typeof configured === 'number' && Number.isFinite(configured) ? Math.min(100, Math.max(1, Math.round(configured))) : 70

export const writeFileOption = (configured: unknown): boolean => configured === true

/** Why a fork gave no save, for the toast. */
export const failureText = (reason: string): string => `QUICKSAVE ✕ SAVE FAILED (${reason}). Compacting anyway.`
