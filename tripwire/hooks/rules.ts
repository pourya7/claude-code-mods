// Pure rule logic: validation, file parsing, tool and field matching, and
// evaluation of a call against the armed rules. No `$`, no state.

import type { TripwireArmedRule, TripwireRule, TripwireRuleAction } from '../types'

export const ACTIONS = ['deny', 'ask', 'rewrite', 'note'] as const
export type RuleAction = TripwireRuleAction
export type Rule = TripwireRule
export type RuleSource = TripwireArmedRule['source']
export type ArmedRule = TripwireArmedRule

export type RuleCheck = { rule: Rule } | { problem: string }

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== ''

/** Checks one raw rule; a problem names the rule and what is wrong with it. */
export const validateRule = (raw: unknown, index: number): RuleCheck => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { problem: `rule #${index + 1} is not an object` }
  }
  const record = raw as Record<string, unknown>
  const label = isText(record.id) ? `"${record.id}"` : `#${index + 1}`
  const fail = (why: string): RuleCheck => ({ problem: `rule ${label}: ${why}` })

  if (!isText(record.id)) return fail('needs an "id"')
  if (!isText(record.tool)) return fail('needs a "tool" (a name, a glob such as mcp__*, or *)')
  if (!isText(record.match)) return fail('needs a "match" regex')
  if (!isText(record.message)) return fail('needs a "message"')
  if (!ACTIONS.includes(record.action as RuleAction)) {
    return fail(`unknown action "${String(record.action)}" (deny, ask, rewrite or note)`)
  }
  if (record.field !== undefined && !isText(record.field)) return fail('"field" must be a field name')
  if (record.cite !== undefined && typeof record.cite !== 'string') return fail('"cite" must be text')
  try {
    new RegExp(record.match)
  } catch (error) {
    return fail(`bad regex: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (record.action === 'rewrite') {
    if (typeof record.replace !== 'string') return fail('a rewrite needs "replace"')
    if (record.field === undefined) return fail('a rewrite needs a "field" to rewrite')
  }

  const rule: Rule = {
    id: record.id,
    tool: record.tool,
    match: record.match,
    action: record.action as RuleAction,
    message: record.message,
  }
  if (record.field !== undefined) rule.field = record.field as string
  if (record.cite !== undefined) rule.cite = record.cite as string
  if (record.action === 'rewrite') rule.replace = record.replace as string
  // Re-order to the documented key order for display and storage.
  const { id, tool, match, field, action, message, cite, replace } = rule
  return { rule: JSON.parse(JSON.stringify({ id, tool, match, field, action, message, cite, replace })) }
}

/** The list of raw rules a file holds: a bare array or `{ "rules": [...] }`. */
export const rawRulesOf = (data: unknown): unknown[] | undefined => {
  if (Array.isArray(data)) return data
  if (typeof data === 'object' && data !== null && Array.isArray((data as { rules?: unknown }).rules)) {
    return (data as { rules: unknown[] }).rules
  }
  return undefined
}

export type ParsedRules = { rules: ArmedRule[]; problems: string[] }

/** Parses one rule file's text; bad rules are skipped and reported, never thrown. */
export const parseRuleFile = (text: string, source: RuleSource): ParsedRules => {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    return {
      rules: [],
      problems: [`${source} file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
  const raws = rawRulesOf(data)
  if (raws === undefined) {
    return { rules: [], problems: [`${source} file must be an array of rules or { "rules": [...] }`] }
  }
  const rules: ArmedRule[] = []
  const problems: string[] = []
  raws.forEach((raw, index) => {
    const checked = validateRule(raw, index)
    if ('problem' in checked) problems.push(`${source} ${checked.problem}`)
    else if (source === 'project' && checked.rule.action === 'rewrite') {
      // A cloned repo must not be able to change the commands you run.
      problems.push(`project rule "${checked.rule.id}": rewrite rules load only from ~/.claude/tripwire.json`)
    } else rules.push({ ...checked.rule, source })
  })
  return { rules, problems }
}

/** Joins the files in order (user, then project); a repeated id is skipped and reported. */
export const mergeRules = (parts: readonly ParsedRules[]): ParsedRules => {
  const seen = new Set<string>()
  const rules: ArmedRule[] = []
  const problems: string[] = []
  for (const part of parts) {
    problems.push(...part.problems)
    for (const rule of part.rules) {
      if (seen.has(rule.id)) {
        problems.push(`${rule.source} rule "${rule.id}": id already used, skipped`)
        continue
      }
      seen.add(rule.id)
      rules.push(rule)
    }
  }
  return { rules, problems }
}

const escapeRegex = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

/** `*` matches every tool; a pattern with `*` is a glob; anything else is exact. */
export const toolMatches = (pattern: string, tool: string): boolean => {
  if (pattern === '*') return true
  if (!pattern.includes('*')) return pattern === tool
  const source = pattern.split('*').map(escapeRegex).join('.*')
  return new RegExp(`^${source}$`).test(tool)
}

/** The text a rule tests: the named field, or the whole input as JSON. */
export const fieldText = (field: string | undefined, input: Record<string, unknown>): string | undefined => {
  if (field === undefined) return JSON.stringify(input)
  const value = input[field]
  if (value === undefined) return undefined
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** One rewrite that changed the input: the field's text before and after. */
export type Rewrite = { rule: Rule; field: string; before: string; after: string }

export type Outcome = {
  deny?: Rule
  asks: Rule[]
  notes: Rule[]
  rewrites: Rewrite[]
  hits: Rule[]
  input: Record<string, unknown>
  isChanged: boolean
}

/**
 * Runs the rules over one call in file order. A deny stops the walk; a
 * rewrite changes the input the later rules see; asks and notes collect.
 */
export const evaluate = (
  rules: readonly Rule[],
  disarmed: readonly string[],
  tool: string,
  original: Record<string, unknown>,
): Outcome => {
  let input = original
  const outcome: Outcome = { asks: [], notes: [], rewrites: [], hits: [], input, isChanged: false }
  for (const rule of rules) {
    if (disarmed.includes(rule.id) || !toolMatches(rule.tool, tool)) continue
    const text = fieldText(rule.field, input)
    if (text === undefined || !new RegExp(rule.match).test(text)) continue
    outcome.hits.push(rule)
    if (rule.action === 'deny') {
      outcome.deny = rule
      break
    }
    if (rule.action === 'ask') outcome.asks.push(rule)
    if (rule.action === 'note') outcome.notes.push(rule)
    if (rule.action === 'rewrite' && rule.field !== undefined && typeof input[rule.field] === 'string') {
      const before = input[rule.field] as string
      const after = before.replace(new RegExp(rule.match, 'g'), rule.replace ?? '')
      if (after !== before) {
        input = { ...input, [rule.field]: after }
        outcome.rewrites.push({ rule, field: rule.field, before, after })
        outcome.isChanged = true
      }
    }
  }
  outcome.input = input
  return outcome
}

/** The tool's own arguments of a `tool.call` event: everything but the envelope. */
export const argumentsOf = (event: Record<string, unknown>): Record<string, unknown> => {
  const { tool: _tool, tool_use_id: _id, agentId: _agent, ...rest } = event
  return rest
}
