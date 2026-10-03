import { describe, expect, test } from 'claude-code/testing'

import { applyFacts, downReason, factsFrom, isSchemaError, serverOf } from '../hooks/learn'
import { repairArguments } from '../hooks/schema'

const ZOD3 = `MCP error -32602: Input validation error: Invalid arguments for tool create_note: [
  { "code": "invalid_type", "expected": "boolean", "received": "string", "path": ["draft"], "message": "Expected boolean, received string" },
  { "code": "invalid_type", "expected": "number", "received": "string", "path": ["filter", "limit"], "message": "Expected number, received string" },
  { "code": "unrecognized_keys", "keys": ["colour"], "path": [], "message": "Unrecognized key(s) in object: 'colour'" }
]`

const ZOD4 = `MCP error -32602: Invalid arguments: [{"expected":"array","code":"invalid_type","path":["labels"],"message":"Invalid input: expected array, received string"}]`

const PYDANTIC = `Error executing tool search: 2 validation errors for searchArguments
limit
  Input should be a valid integer, unable to parse string as an integer [type=int_parsing, input_value='ten', input_type=str]
colour
  Extra inputs are not permitted [type=extra_forbidden, input_value='red', input_type=str]`

const AJV = `Invalid params: data/draft must be boolean, data must NOT have additional properties (additionalProperty: "colour")`

describe('isSchemaError', () => {
  test('recognises the common validator shapes', () => {
    for (const text of [ZOD3, ZOD4, PYDANTIC, AJV, '"limit" must be a number']) expect(isSchemaError(text)).toBe(true)
  })

  test('ignores ordinary tool errors', () => {
    for (const text of ['Note not found', 'rate limited, try again', 'permission denied for repo', '']) expect(isSchemaError(text)).toBe(false)
  })
})

describe('factsFrom', () => {
  test('zod v3 issues: types at nested paths and unrecognized keys', () => {
    expect(factsFrom(ZOD3)).toEqual([
      { path: ['draft'], expected: 'boolean' },
      { path: ['filter', 'limit'], expected: 'number' },
      { path: [], rejectKeys: ['colour'] },
    ])
  })

  test('zod v4 issues', () => {
    expect(factsFrom(ZOD4)).toEqual([{ path: ['labels'], expected: 'array' }])
  })

  test('pydantic errors', () => {
    expect(factsFrom(PYDANTIC)).toEqual([
      { path: ['limit'], expected: 'integer' },
      { path: [], rejectKeys: ['colour'] },
    ])
  })

  test('ajv errors', () => {
    expect(factsFrom(AJV)).toEqual([
      { path: ['draft'], expected: 'boolean' },
      { path: [], rejectKeys: ['colour'] },
    ])
  })

  test('joi-style messages', () => {
    expect(factsFrom('"filter.limit" must be a number')).toEqual([{ path: ['filter', 'limit'], expected: 'number' }])
  })

  test('nothing usable in an ordinary error', () => {
    expect(factsFrom('Note not found')).toEqual([])
  })
})

describe('applyFacts', () => {
  test('builds a partial schema the repairer can use', () => {
    const schema = applyFacts(undefined, factsFrom(ZOD3))
    const { args } = repairArguments(schema, { draft: 'true', filter: { limit: '5', q: 'x' }, colour: 'red', title: 'kept' })
    expect(args).toEqual({ draft: true, filter: { limit: 5, q: 'x' }, title: 'kept' })
  })

  test('numeric path segments describe array items', () => {
    const schema = applyFacts(undefined, [{ path: ['ids', '0'], expected: 'integer' }])
    expect(repairArguments(schema, { ids: ['1', '2'] }).args).toEqual({ ids: [1, 2] })
  })

  test('merges with what was learned before', () => {
    const first = applyFacts(undefined, [{ path: ['draft'], expected: 'boolean' }])
    const second = applyFacts(first, [{ path: ['limit'], expected: 'integer' }])
    expect(repairArguments(second, { draft: 'false', limit: '3' }).args).toEqual({ draft: false, limit: 3 })
  })

  test('prototype path segments from server text are ignored, Object.prototype stays clean', () => {
    const text = 'MCP error -32602: Invalid arguments: [{"code":"invalid_type","expected":"boolean","path":["__proto__"]},{"code":"invalid_type","expected":"boolean","path":["constructor","type"]},{"code":"invalid_type","expected":"integer","path":["a","prototype"]},{"code":"invalid_type","expected":"boolean","path":["ok"]}]'
    const schema = applyFacts(undefined, factsFrom(text))
    expect(({} as Record<string, unknown>).type).toBeUndefined()
    expect((Object as unknown as Record<string, unknown>).type).toBeUndefined()
    expect(Object.keys(schema.properties ?? {})).toEqual(['ok'])
    expect(repairArguments({ properties: { q: { type: 'boolean' } } }, { q: 'true' }).args).toEqual({ q: true })
    expect(repairArguments(schema, { ok: 'true' }).args).toEqual({ ok: true })
  })

  test('does not mutate the schema it starts from', () => {
    const first = applyFacts(undefined, [{ path: ['draft'], expected: 'boolean' }])
    const copy = JSON.stringify(first)
    applyFacts(first, [{ path: [], rejectKeys: ['x'] }])
    expect(JSON.stringify(first)).toBe(copy)
  })
})

describe('down detection', () => {
  test('disconnected and unauthenticated servers', () => {
    for (const text of [
      'MCP server "notes" is not connected',
      'Error: connection closed',
      'Request failed: 401 Unauthorized',
      'Authentication required: please re-authenticate the server',
      'connect ECONNREFUSED 127.0.0.1:8931',
      'Server disconnected',
      'Your token has expired',
    ]) expect(downReason(text)).toBeDefined()
  })

  test('ordinary errors that mention 401, unauthorized or disconnected are not down', () => {
    for (const text of [
      'Issue #401 not found in repo',
      'Line 401: syntax error',
      'Not Found: issue 401 does not exist',
      'Unauthorized to access repo private/x',
      'You are unauthorized to delete this note',
      'Issue is not connected to a project',
      'The device was disconnected from the account',
    ]) expect(downReason(text)).toBeUndefined()
  })

  test('a deny is down only when it reads as a broken connection', () => {
    expect(downReason('Unauthorized: writes to prod are blocked', { isDeny: true })).toBeUndefined()
    expect(downReason('Authentication required: please re-authenticate', { isDeny: true })).toBeUndefined()
    expect(downReason('connect ECONNREFUSED 127.0.0.1:8931', { isDeny: true })).toBeDefined()
    expect(downReason('MCP server "notes" is not connected', { isDeny: true })).toBeDefined()
  })

  test('ordinary and schema errors are not down', () => {
    for (const text of [ZOD3, 'Note not found', 'rate limited']) expect(downReason(text)).toBeUndefined()
  })

  test('serverOf reads the server segment', () => {
    expect(serverOf('mcp__notes__create_note')).toBe('notes')
    expect(serverOf('mcp__claude_ai_Docs__search')).toBe('claude_ai_Docs')
    expect(serverOf('Bash')).toBeUndefined()
  })
})
