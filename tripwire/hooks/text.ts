// The words tripwire says: the deny the model reads, notes, the ask reason,
// the status line, and the hit bookkeeping kept in $.store.
import type { Hits } from '../types'
import type { Rewrite, Rule } from './rules'

const citeOf = (rule: Rule) => (rule.cite ? ` (${rule.cite})` : '')

/** The deny the model reads as the tool's error. */
export const trapText = (rule: Rule): string =>
  [
    '▛▀▀▀▀▀▀▀▀▀▀▀▀▀▀▜',
    `▌ TRAP SPRUNG! ▐  [${rule.id}]`,
    '▙▄▄▄▄▄▄▄▄▄▄▄▄▄▄▟',
    rule.message,
    ...(rule.cite ? [`CITE ${rule.cite}`] : []),
    'This call was blocked by a tripwire rule. Do not retry it in another form; take another approach or ask the user.',
  ].join('\n')

/** What a note rule attaches for the model after the tool's result. */
export const noteText = (rule: Rule): string => `tripwire note [${rule.id}]: ${rule.message}${citeOf(rule)}`

/** What the model reads after a rewrite rule changed its call. */
export const rewriteText = ({ rule, field, before, after }: Rewrite): string =>
  `tripwire rewrite [${rule.id}]: ${rule.message}${citeOf(rule)} (${field} was: ${before} → now: ${after})`

/** The permission dialog's reason when ask rules matched. */
export const askReason = (rules: readonly Rule[]): string =>
  `TRIPWIRE ${rules.map(rule => `[${rule.id}] ${rule.message}${citeOf(rule)}`).join(' | ')}`

/** Adds one hit per id, stamped `now` (never moving lastHit back); returns a new map. */
export const recordHits = (hits: Hits, ids: readonly string[], now: number): Hits => {
  const next: Hits = { ...hits }
  for (const id of ids) {
    const old = next[id]
    next[id] = { count: (old?.count ?? 0) + 1, lastHit: Math.max(old?.lastHit ?? now, now) }
  }
  return next
}

/** A stored hits value as a map, or undefined when it is not one. */
export const hitsOf = (value: unknown): Hits | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Hits) : undefined

/** The status line: under 40 columns. */
export const statusText = (armed: number, bad: number): string =>
  `▲ TRIPWIRE ${armed} ARMED${bad > 0 ? ` · ${bad} BAD` : ''}`

const two = (n: number) => String(n).padStart(2, '0')

/** A last-hit time as HH:MM, or a dash when the rule never fired. */
export const clockText = (ms: number | undefined): string => {
  if (ms === undefined) return '--:--'
  const at = new Date(ms)
  return `${two(at.getHours())}:${two(at.getMinutes())}`
}
