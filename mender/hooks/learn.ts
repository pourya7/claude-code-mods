// Reads an MCP tool's error text: is it a schema complaint, what shape did the
// server ask for, and is the server down rather than the call wrong.

import type { JsonSchema } from './schema'

export type LearnedType = 'boolean' | 'integer' | 'number' | 'array' | 'object'

/** One thing a validation error says about the expected shape. */
export type Fact = { path: string[]; expected: LearnedType } | { path: string[]; rejectKeys: string[] }

const LEARNABLE = new Set<string>(['boolean', 'integer', 'number', 'array', 'object'])

const SCHEMA_ERROR =
  /-32602|invalid (?:params|arguments|input)\b|input validation error|validation errors? for|must be (?:an? )?(?:boolean|integer|number|string|array|object)\b|expected (?:boolean|number|integer|array|object|string)\b|input should be a valid|extra inputs are not permitted|unrecogni[sz]ed keys?|additional propert/i

/** True when the error text is a complaint about the arguments' shape. */
export const isSchemaError = (text: string): boolean => SCHEMA_ERROR.test(text)

/**
 * Outage shapes, anchored to transport and auth wording so an ordinary error
 * that mentions "401" or "unauthorized" (an issue number, a per-item
 * permission) never reads as a dead server. `isConnection` marks the ones that
 * also count in a deny; a deny comes from a hook or a policy, which may well
 * say "unauthorized" about a healthy server.
 */
const DOWN: readonly { pattern: RegExp; reason: string; isConnection: boolean }[] = [
  {
    pattern: /\b(?:mcp )?server\b[^\n]{0,80}?\bis not connected\b|\bnot connected to (?:the |any )?(?:mcp )?server\b/i,
    reason: 'not connected',
    isConnection: true,
  },
  { pattern: /\b(?:server|transport|client|connection|session)\s+(?:(?:was|has been|is|got)\s+)?disconnected\b/i, reason: 'disconnected', isConnection: true },
  { pattern: /\bconnection (?:closed|refused|lost|reset)\b/i, reason: 'connection lost', isConnection: true },
  { pattern: /\bECONN(?:REFUSED|RESET)\b/, reason: 'connection refused', isConnection: true },
  { pattern: /\bfailed to connect\b/i, reason: 'failed to connect', isConnection: true },
  { pattern: /\b(?:HTTP(?:\/[\d.]+)?|status(?: code)?)\s*:?\s*401\b|\b401 Unauthori[sz]ed\b|\binvalid_token\b/i, reason: 'unauthorized', isConnection: false },
  {
    pattern: /\bunauthenticated\b|\bauthentication (?:required|failed)\b|\bneeds? (?:re-?)?auth|\bre-?authenticate\b/i,
    reason: 'needs auth',
    isConnection: false,
  },
  { pattern: /\b(?:access |auth |oauth )?token (?:has )?expired\b/i, reason: 'token expired', isConnection: false },
]

/**
 * Why the server looks down, or undefined when the error is about the call
 * itself. With `isDeny`, only a broken connection counts.
 */
export const downReason = (text: string, { isDeny = false }: { isDeny?: boolean } = {}): string | undefined => {
  if (isSchemaError(text)) return undefined
  return DOWN.find(({ pattern, isConnection }) => (isConnection || !isDeny) && pattern.test(text))?.reason
}

/** `mcp__<server>__<tool>` → `<server>`. */
export const serverOf = (tool: string): string | undefined => {
  if (!tool.startsWith('mcp__')) return undefined
  const server = tool.split('__')[1]
  return server === undefined || server === '' ? undefined : server
}

const splitPath = (text: string): string[] =>
  text
    .replace(/\[(\d+)\]/g, '.$1')
    .split(/[./]/)
    .filter(part => part !== '')

const learnable = (expected: unknown): LearnedType | undefined =>
  typeof expected === 'string' && LEARNABLE.has(expected.toLowerCase()) ? (expected.toLowerCase() as LearnedType) : undefined

/** Zod (the MCP TypeScript SDK's validator): a JSON list of issues. */
const zodFacts = (text: string): Fact[] | undefined => {
  const start = text.search(/\[\s*\{/)
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return undefined
  let issues: unknown
  try {
    issues = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (!Array.isArray(issues)) return undefined
  const facts: Fact[] = []
  for (const issue of issues) {
    if (typeof issue !== 'object' || issue === null) continue
    const { code, expected, path, keys } = issue as Record<string, unknown>
    const at = Array.isArray(path) ? path.map(String) : []
    if (code === 'unrecognized_keys' && Array.isArray(keys)) facts.push({ path: at, rejectKeys: keys.map(String) })
    else if (code === 'invalid_type' && learnable(expected) !== undefined) facts.push({ path: at, expected: learnable(expected)! })
  }
  return facts
}

const PYDANTIC_TYPES: readonly [RegExp, LearnedType][] = [
  [/valid boolean|type=bool_/i, 'boolean'],
  [/valid integer|type=int_/i, 'integer'],
  [/valid number|type=float_/i, 'number'],
  [/valid (?:list|array|tuple)|type=(?:list|tuple)_/i, 'array'],
  [/valid dictionary|valid object|type=(?:dict|model)_type/i, 'object'],
]

/** Pydantic (the MCP Python SDK's validator): a path line, then an indented message. */
const pydanticFacts = (text: string): Fact[] => {
  if (!/validation errors? for/i.test(text)) return []
  const lines = text.split('\n')
  const facts: Fact[] = []
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const pathLine = lines[i] ?? ''
    const message = lines[i + 1] ?? ''
    if (/^\s/.test(pathLine) || pathLine.trim() === '' || /validation error/i.test(pathLine) || !/^\s+\S/.test(message)) continue
    const path = splitPath(pathLine.trim())
    if (/extra inputs are not permitted|type=extra_forbidden/i.test(message)) {
      const key = path.pop()
      if (key !== undefined) facts.push({ path, rejectKeys: [key] })
      continue
    }
    const hit = PYDANTIC_TYPES.find(([pattern]) => pattern.test(message))
    if (hit) facts.push({ path, expected: hit[1] })
  }
  return facts
}

/** Ajv and Joi style messages: `data/draft must be boolean`, `"limit" must be a number`. */
const messageFacts = (text: string): Fact[] => {
  const facts: Fact[] = []
  let rest = text
  for (const match of text.matchAll(/"([\w.[\]-]+)" must be (?:an? )?(boolean|integer|number|array|object)\b/gi)) {
    facts.push({ path: splitPath(match[1] ?? ''), expected: learnable(match[2])! })
    rest = rest.replace(match[0], ' ')
  }
  for (const match of rest.matchAll(
    /(?:\b(?:data|instance)((?:[./][\w-]+|\[\d+\])*)|(?:^|\s)((?:\/[\w-]+)+))\s+must be (?:an? )?(boolean|integer|number|array|object)\b/gi,
  )) {
    facts.push({ path: splitPath(match[1] ?? match[2] ?? ''), expected: learnable(match[3])! })
  }
  for (const match of rest.matchAll(
    /(?:\b(?:data|instance)((?:[./][\w-]+)*)\s+)?must NOT have additional properties\s*\(?\s*additionalProperty["']?\s*[:=]\s*["']?([\w-]+)/gi,
  )) {
    facts.push({ path: splitPath(match[1] ?? ''), rejectKeys: [match[2] ?? ''] })
  }
  const unrecognized = /Unrecogni[sz]ed keys?(?:\(s\))? in object: ((?:'[^']+'(?:,\s*)?)+)/i.exec(rest)
  if (unrecognized) {
    const keys = [...(unrecognized[1] ?? '').matchAll(/'([^']+)'/g)].map(key => key[1] ?? '')
    facts.push({ path: [], rejectKeys: keys })
  }
  return facts
}

/** What the error text says about the expected shape; empty when nothing usable. */
export const factsFrom = (text: string): Fact[] => {
  if (!isSchemaError(text)) return []
  const zod = zodFacts(text)
  if (zod !== undefined && zod.length > 0) return zod
  const pydantic = pydanticFacts(text)
  if (pydantic.length > 0) return pydantic
  return messageFacts(text)
}

const isIndex = (part: string) => /^\d+$/.test(part)

/** Path parts that would walk onto a prototype; the text comes from the server, so never trusted. */
const UNSAFE_PARTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

const ownChild = (properties: Record<string, JsonSchema>, key: string): JsonSchema => {
  if (!Object.prototype.hasOwnProperty.call(properties, key)) properties[key] = {}
  return properties[key] as JsonSchema
}

/** Folds facts into a (partial) schema; returns a new schema, never mutating `base`. */
export const applyFacts = (base: JsonSchema | undefined, facts: readonly Fact[]): JsonSchema => {
  const schema: JsonSchema = base === undefined ? { type: 'object', properties: {} } : JSON.parse(JSON.stringify(base))
  for (const fact of facts) {
    if (fact.path.some(part => UNSAFE_PARTS.has(part))) continue
    let node = schema
    for (const part of fact.path) {
      if (isIndex(part)) {
        node.type = 'array'
        const items = typeof node.items === 'object' && !Array.isArray(node.items) ? node.items : {}
        node.items = items
        node = items
      } else {
        if (node.type === undefined || node.type !== 'object') node.type = 'object'
        node = ownChild((node.properties ??= {}), part)
      }
    }
    if ('expected' in fact) {
      node.type = fact.expected
    } else {
      node.type = 'object'
      node.properties ??= {}
      node['x-mender-reject'] = [...new Set([...(node['x-mender-reject'] ?? []), ...fact.rejectKeys])]
    }
  }
  return schema
}

const typesOf = (schema: JsonSchema): string[] =>
  typeof schema.type === 'string' ? [schema.type] : Array.isArray(schema.type) ? schema.type.filter(one => typeof one === 'string') : []

/**
 * Lays a learned shape over a schema from the file, returning a new schema.
 * What the server said wins: a type it asked for replaces one the file does not
 * already allow, and keys it rejected are added. Everything else in the file
 * (closed objects, enums, unions) stays.
 */
export const overlayLearned = (base: JsonSchema, learned: JsonSchema): JsonSchema => {
  const out: JsonSchema = { ...base }
  const wanted = typesOf(learned)
  if (wanted.length > 0 && !wanted.every(type => typesOf(base).includes(type))) {
    out.type = learned.type
    delete out.anyOf
    delete out.oneOf
  }
  const rejected = learned['x-mender-reject']
  if (Array.isArray(rejected) && rejected.length > 0) {
    out['x-mender-reject'] = [...new Set([...(base['x-mender-reject'] ?? []), ...rejected])]
  }
  if (learned.properties !== undefined) {
    const properties: Record<string, JsonSchema> = { ...(base.properties ?? {}) }
    for (const [key, child] of Object.entries(learned.properties)) {
      if (UNSAFE_PARTS.has(key)) continue
      const own = Object.prototype.hasOwnProperty.call(properties, key) ? properties[key] : undefined
      properties[key] = overlayLearned(own ?? {}, child)
    }
    out.properties = properties
  }
  if (learned.items !== undefined && !Array.isArray(learned.items)) {
    const items = base.items !== undefined && !Array.isArray(base.items) ? base.items : {}
    out.items = overlayLearned(items, learned.items)
  }
  return out
}
