import { describe, expect, test } from 'claude-code/testing'

import { parseSchemaFile, repairArguments } from '../hooks/schema'
import type { JsonSchema } from '../hooks/schema'

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    draft: { type: 'boolean' },
    limit: { type: 'integer' },
    ratio: { type: 'number' },
    labels: { type: 'array', items: { type: 'string' } },
    ids: { type: 'array', items: { type: 'integer' } },
    filter: { type: 'object', properties: { open: { type: 'boolean' } } },
    title: { type: 'string' },
  },
  additionalProperties: false,
}

describe('coercions with a schema', () => {
  test('"true" / "false" become booleans', () => {
    const { args, repairs } = repairArguments(SCHEMA, { draft: 'true' })
    expect(args).toEqual({ draft: true })
    expect(repairs).toEqual([{ path: 'draft', kind: 'boolean', from: '"true"', to: 'true' }])
    expect(repairArguments(SCHEMA, { draft: 'FALSE ' }).args).toEqual({ draft: false })
  })

  test('numeric strings become numbers, integers only when whole', () => {
    expect(repairArguments(SCHEMA, { limit: '10', ratio: '0.5' }).args).toEqual({ limit: 10, ratio: 0.5 })
    expect(repairArguments(SCHEMA, { limit: '10.5' }).args).toEqual({ limit: '10.5' })
    expect(repairArguments(SCHEMA, { ratio: 'ten' }).repairs).toEqual([])
    expect(repairArguments(SCHEMA, { ratio: '' }).repairs).toEqual([])
    expect(repairArguments(SCHEMA, { ratio: '0x10' }).repairs).toEqual([])
  })

  test('a number that would lose digits is left as the string the model wrote', () => {
    for (const id of ['12345678901234567890', '1234567890123456789', '9007199254740993']) {
      expect(repairArguments(SCHEMA, { limit: id }).repairs).toEqual([])
      expect(repairArguments(SCHEMA, { limit: id }).args).toEqual({ limit: id })
      expect(repairArguments(SCHEMA, { ratio: id }).args).toEqual({ ratio: id })
    }
    expect(repairArguments(SCHEMA, { ratio: '0.12345678901234567891' }).repairs).toEqual([])
    expect(repairArguments(SCHEMA, { limit: '9007199254740991', ratio: '1e3' }).args).toEqual({ limit: 9007199254740991, ratio: 1000 })
  })

  test('a single value becomes [value] when an array is expected', () => {
    const { args, repairs } = repairArguments(SCHEMA, { labels: 'bug' })
    expect(args).toEqual({ labels: ['bug'] })
    expect(repairs[0]).toMatchObject({ path: 'labels', kind: 'array' })
    expect(repairArguments(SCHEMA, { ids: '7' }).args).toEqual({ ids: [7] })
  })

  test('a JSON array string becomes the array, items repaired', () => {
    expect(repairArguments(SCHEMA, { ids: '[1, "2"]' }).args).toEqual({ ids: [1, 2] })
  })

  test('a JSON string becomes an object when an object is expected', () => {
    const { args, repairs } = repairArguments(SCHEMA, { filter: '{"open": "true"}' })
    expect(args).toEqual({ filter: { open: true } })
    expect(repairs.map(repair => repair.kind)).toEqual(['object', 'boolean'])
    expect(repairs[1]?.path).toBe('filter.open')
  })

  test('a string that is not a JSON object is left alone', () => {
    expect(repairArguments(SCHEMA, { filter: 'open' }).repairs).toEqual([])
    expect(repairArguments(SCHEMA, { filter: '[1]' }).repairs).toEqual([])
  })

  test('items inside arrays are repaired with their path', () => {
    const { args, repairs } = repairArguments(SCHEMA, { ids: ['1', 2] })
    expect(args).toEqual({ ids: [1, 2] })
    expect(repairs[0]?.path).toBe('ids[0]')
  })
})

describe('unknown keys', () => {
  test('dropped when additionalProperties is false', () => {
    const { args, repairs } = repairArguments(SCHEMA, { title: 'x', colour: 'red' })
    expect(args).toEqual({ title: 'x' })
    expect(repairs).toEqual([{ path: 'colour', kind: 'drop', from: '"red"', to: '' }])
  })

  test('kept when additionalProperties is absent or true', () => {
    const open: JsonSchema = { type: 'object', properties: { title: { type: 'string' } } }
    expect(repairArguments(open, { title: 'x', colour: 'red' }).args).toEqual({ title: 'x', colour: 'red' })
    expect(repairArguments({ ...open, additionalProperties: true }, { colour: 'red' }).repairs).toEqual([])
    expect(repairArguments({ ...open, additionalProperties: { type: 'string' } }, { colour: 'red' }).repairs).toEqual([])
  })

  test('kept when patternProperties could match', () => {
    const patterned: JsonSchema = { type: 'object', properties: {}, patternProperties: { '^x-': {} }, additionalProperties: false }
    expect(repairArguments(patterned, { 'x-a': 1 }).repairs).toEqual([])
  })

  test('keys the server rejected before are dropped (learned)', () => {
    const learned: JsonSchema = { type: 'object', properties: {}, 'x-mender-reject': ['colour'] }
    expect(repairArguments(learned, { colour: 'red', title: 'x' }).args).toEqual({ title: 'x' })
  })
})

describe('never changes what already satisfies the schema', () => {
  test('valid input is a no-op', () => {
    const input = { draft: true, limit: 3, ratio: 1.5, labels: ['a'], ids: [1], filter: { open: false }, title: 'true' }
    const { args, repairs } = repairArguments(SCHEMA, input)
    expect(repairs).toEqual([])
    expect(args).toEqual(input)
  })

  test('a string field holding "true" or "10" stays a string', () => {
    expect(repairArguments(SCHEMA, { title: '10' }).repairs).toEqual([])
  })

  test('a union that allows strings leaves strings alone', () => {
    const union: JsonSchema = { type: 'object', properties: { size: { type: ['string', 'number'] }, flag: { anyOf: [{ type: 'string' }, { type: 'boolean' }] } } }
    expect(repairArguments(union, { size: '10', flag: 'true' }).repairs).toEqual([])
  })

  test('a union without strings still repairs', () => {
    const union: JsonSchema = { type: 'object', properties: { size: { anyOf: [{ type: 'integer' }, { type: 'null' }] } } }
    expect(repairArguments(union, { size: '10' }).args).toEqual({ size: 10 })
  })

  test('a coercion that would leave the enum is not made', () => {
    const enumed: JsonSchema = { type: 'object', properties: { level: { type: 'integer', enum: [1, 2] } } }
    expect(repairArguments(enumed, { level: '5' }).repairs).toEqual([])
    expect(repairArguments(enumed, { level: '2' }).args).toEqual({ level: 2 })
  })

  test('never invents a value: missing required keys stay missing', () => {
    const required: JsonSchema = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }
    expect(repairArguments(required, {}).args).toEqual({})
  })

  test('no schema type means no coercion', () => {
    expect(repairArguments({ type: 'object', properties: { any: {} } }, { any: 'true' }).repairs).toEqual([])
  })

  test('the input object is not mutated', () => {
    const input = { draft: 'true', colour: 'x' }
    repairArguments(SCHEMA, input)
    expect(input).toEqual({ draft: 'true', colour: 'x' })
  })
})

describe('parseSchemaFile', () => {
  test('a map of tool names to schemas', () => {
    const { schemas, problems } = parseSchemaFile(JSON.stringify({ mcp__notes__create: SCHEMA }))
    expect(schemas).toEqual({ mcp__notes__create: SCHEMA })
    expect(problems).toEqual([])
  })

  test("a server's tools/list answer", () => {
    const text = JSON.stringify({ servers: { notes: { tools: [{ name: 'create', inputSchema: SCHEMA }] } } })
    expect(parseSchemaFile(text).schemas).toEqual({ mcp__notes__create: SCHEMA })
  })

  test('bad entries are reported and skipped', () => {
    const { schemas, problems } = parseSchemaFile(JSON.stringify({ Bash: {}, mcp__a__b: 'x', mcp__a__c: SCHEMA }))
    expect(Object.keys(schemas)).toEqual(['mcp__a__c'])
    expect(problems).toHaveLength(2)
    expect(parseSchemaFile('{oops').problems[0]).toMatch(/not JSON/)
  })
})
