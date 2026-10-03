// Repairs an MCP tool's arguments against a JSON schema: only known-safe
// mistakes, only where the value does not already fit, never an invented value.

/** The subset of JSON Schema mender reads. Anything else is ignored. */
export type JsonSchema = {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  additionalProperties?: boolean | JsonSchema
  patternProperties?: Record<string, JsonSchema>
  items?: JsonSchema | JsonSchema[]
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  enum?: unknown[]
  required?: string[]
  /** Keys the server itself rejected (learned from its validation errors). */
  'x-mender-reject'?: string[]
  [keyword: string]: unknown
}

export type RepairKind = 'boolean' | 'number' | 'array' | 'object' | 'drop'

export type Repair = {
  /** Where, as `filter.open` or `ids[0]`. */
  path: string
  kind: RepairKind
  /** The value as the model sent it, as JSON. */
  from: string
  /** The value as it went to the tool, as JSON ('' for a dropped key). */
  to: string
}

type JsonType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null'

const NUMERIC = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/

/**
 * True when a numeric string survives the trip to a JS number digit for digit:
 * a whole number within 2^53 - 1, or a fraction of at most 15 significant
 * digits. A 19-digit ID must not quietly become a different ID.
 */
const isExact = (numeric: string): boolean => {
  const [mantissa = ''] = numeric.replace(/^-/, '').split(/[eE]/)
  const digits = mantissa.replace('.', '').replace(/^0+/, '').replace(/0+$/, '')
  const value = Number(numeric)
  return Number.isInteger(value) ? Number.isSafeInteger(value) && digits.length <= 16 : digits.length <= 15
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asSchema = (value: unknown): JsonSchema | undefined => (isPlainObject(value) ? (value as JsonSchema) : undefined)

/** Short JSON for a repair line. */
export const shortJson = (value: unknown, max = 40): string => {
  let text: string
  try {
    text = JSON.stringify(value) ?? String(value)
  } catch {
    text = String(value)
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const branchesOf = (schema: JsonSchema): JsonSchema[] =>
  [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])].map(asSchema).filter((one): one is JsonSchema => one !== undefined)

/** The JSON types a schema node allows, or undefined when it says nothing usable. */
const allowedTypes = (schema: JsonSchema): Set<JsonType> | undefined => {
  if (typeof schema.type === 'string') return new Set([schema.type as JsonType])
  if (Array.isArray(schema.type)) return new Set(schema.type.filter((one): one is JsonType => typeof one === 'string'))
  const branches = branchesOf(schema)
  if (branches.length > 0) {
    const all = new Set<JsonType>()
    for (const branch of branches) {
      const types = allowedTypes(branch)
      if (types === undefined) return undefined
      for (const type of types) all.add(type)
    }
    return all
  }
  if (schema.properties !== undefined) return new Set(['object'])
  if (schema.items !== undefined) return new Set(['array'])
  return undefined
}

const fitsType = (value: unknown, type: JsonType): boolean => {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isPlainObject(value)
    case 'null':
      return value === null
  }
}

const fitsEnum = (schema: JsonSchema, value: unknown): boolean =>
  !Array.isArray(schema.enum) || schema.enum.some(one => JSON.stringify(one) === JSON.stringify(value))

/** The branch to descend into for a value of this type (the node itself when it has no branches). */
const shapeFor = (schema: JsonSchema, type: 'object' | 'array'): JsonSchema => {
  const branches = branchesOf(schema)
  if (branches.length === 0) return schema
  return branches.find(branch => allowedTypes(branch)?.has(type)) ?? schema
}

const join = (path: string, key: string) => (path === '' ? key : `${path}.${key}`)

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const repairObject = (schema: JsonSchema, value: Record<string, unknown>, path: string, repairs: Repair[]) => {
  const shape = shapeFor(schema, 'object')
  const properties = asSchema(shape.properties) as Record<string, JsonSchema> | undefined
  const rejected = Array.isArray(shape['x-mender-reject']) ? shape['x-mender-reject'] : []
  const isClosed =
    shape.additionalProperties === false && properties !== undefined && Object.keys(shape.patternProperties ?? {}).length === 0
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const known = properties !== undefined && Object.prototype.hasOwnProperty.call(properties, key)
    if ((!known && isClosed) || (!known && rejected.includes(key))) {
      repairs.push({ path: join(path, key), kind: 'drop', from: shortJson(child), to: '' })
      continue
    }
    const childSchema = known ? asSchema(properties?.[key]) : undefined
    const repaired = childSchema === undefined ? child : repairValue(childSchema, child, join(path, key), repairs)
    // defineProperty keeps a key such as `__proto__` an own key, as the model sent it.
    Object.defineProperty(out, key, { value: repaired, enumerable: true, writable: true, configurable: true })
  }
  return out
}

const repairArray = (schema: JsonSchema, value: unknown[], path: string, repairs: Repair[]) => {
  const items = asSchema(shapeFor(schema, 'array').items)
  if (items === undefined) return value
  return value.map((item, index) => repairValue(items, item, `${path}[${index}]`, repairs))
}

/** Tries to turn `value` into one of `types`; undefined when no safe coercion fits. */
const coerce = (schema: JsonSchema, value: unknown, types: Set<JsonType>, path: string): { value: unknown; kind: RepairKind } | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const lower = trimmed.toLowerCase()
    if (types.has('boolean') && (lower === 'true' || lower === 'false')) {
      const candidate = lower === 'true'
      if (fitsEnum(schema, candidate)) return { value: candidate, kind: 'boolean' }
    }
    if ((types.has('number') || types.has('integer')) && NUMERIC.test(trimmed) && isExact(trimmed)) {
      const candidate = Number(trimmed)
      const fits = types.has('number') ? Number.isFinite(candidate) : Number.isSafeInteger(candidate)
      if (fits && fitsEnum(schema, candidate)) return { value: candidate, kind: 'number' }
    }
    if (types.has('object') && trimmed.startsWith('{')) {
      const parsed = parseJson(trimmed)
      if (isPlainObject(parsed)) return { value: parsed, kind: 'object' }
    }
    if (types.has('array') && trimmed.startsWith('[')) {
      const parsed = parseJson(trimmed)
      if (Array.isArray(parsed)) return { value: parsed, kind: 'array' }
    }
  }
  if (types.has('array') && !Array.isArray(value) && value !== undefined) {
    // A single value wraps only when it fits (or can be made to fit) the items.
    const items = asSchema(shapeFor(schema, 'array').items)
    const itemTypes = items === undefined ? undefined : allowedTypes(items)
    if (itemTypes === undefined || [...itemTypes].some(type => fitsType(value, type))) return { value: [value], kind: 'array' }
    if (items !== undefined && coerce(items, value, itemTypes, path) !== undefined) return { value: [value], kind: 'array' }
  }
  return undefined
}

const repairValue = (schema: JsonSchema, value: unknown, path: string, repairs: Repair[]): unknown => {
  const types = allowedTypes(schema)
  if (types === undefined) return value
  const fitting = [...types].find(type => fitsType(value, type))
  if (fitting !== undefined) {
    if (isPlainObject(value) && types.has('object')) return repairObject(schema, value, path, repairs)
    if (Array.isArray(value) && types.has('array')) return repairArray(schema, value, path, repairs)
    return value
  }
  const coerced = coerce(schema, value, types, path)
  if (coerced === undefined) return value
  repairs.push({ path, kind: coerced.kind, from: shortJson(value), to: shortJson(coerced.value) })
  if (isPlainObject(coerced.value)) return repairObject(schema, coerced.value, path, repairs)
  if (Array.isArray(coerced.value)) return repairArray(schema, coerced.value, path, repairs)
  return coerced.value
}

/**
 * Repairs `args` against the tool's input schema. Returns new arguments and the
 * repairs made; the input is never mutated, and a value that already fits the
 * schema is never changed.
 */
export const repairArguments = (
  schema: JsonSchema,
  args: Record<string, unknown>,
): { args: Record<string, unknown>; repairs: Repair[] } => {
  const repairs: Repair[] = []
  const root: JsonSchema = allowedTypes(schema) === undefined ? { ...schema, type: 'object' } : schema
  const repaired = repairValue(root, args, '', repairs)
  return { args: isPlainObject(repaired) ? repaired : args, repairs }
}

/**
 * Reads a schema file. Two shapes, which may be mixed:
 * - a map of full tool names to input schemas: `{ "mcp__notes__create": { ... } }`
 * - a server's `tools/list` answer: `{ "servers": { "notes": { "tools": [{ "name", "inputSchema" }] } } }`
 */
export const parseSchemaFile = (text: string): { schemas: Record<string, JsonSchema>; problems: string[] } => {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    return { schemas: {}, problems: [`not JSON (${error instanceof Error ? error.message : String(error)})`] }
  }
  if (!isPlainObject(data)) return { schemas: {}, problems: ['not a JSON object'] }
  const schemas: Record<string, JsonSchema> = {}
  const problems: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (key === 'servers') {
      if (!isPlainObject(value)) {
        problems.push('"servers" is not an object')
        continue
      }
      for (const [server, listing] of Object.entries(value)) {
        const tools = isPlainObject(listing) ? listing.tools : listing
        if (!Array.isArray(tools)) {
          problems.push(`servers.${server} has no "tools" list`)
          continue
        }
        for (const tool of tools) {
          const name = isPlainObject(tool) ? tool.name : undefined
          const schema = isPlainObject(tool) ? asSchema(tool.inputSchema ?? tool.input_schema) : undefined
          if (typeof name !== 'string' || schema === undefined) problems.push(`servers.${server}: a tool without a name or inputSchema`)
          else schemas[`mcp__${server}__${name}`] = schema
        }
      }
      continue
    }
    if (!key.startsWith('mcp__')) {
      problems.push(`"${key}" is not an MCP tool name (mcp__<server>__<tool>)`)
      continue
    }
    const schema = asSchema(value)
    if (schema === undefined) problems.push(`"${key}" is not a schema object`)
    else schemas[key] = schema
  }
  return { schemas, problems }
}
