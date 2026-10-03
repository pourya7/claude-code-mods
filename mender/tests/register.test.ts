import { describe, expect, test } from 'claude-code/testing'

import { SCHEMA_FILE, START, ZOD_ERROR, argsOf, run, schemaFile, world } from './world'

const call = ($: Parameters<Parameters<typeof test>[1]>[0], input: Record<string, unknown>) =>
  $.tool.call(input as never) as Promise<{ deny?: string; context?: readonly string[]; isError?: boolean; text?: string }>

describe('repairs before the call, against the schema', () => {
  test('"true"/"false" become booleans and numeric strings numbers', async ($, on) => {
    const w = world(on, { [SCHEMA_FILE]: schemaFile() })
    await $.session.start(START)
    const result = await call($, { tool: 'mcp__notes__create', title: 'x', draft: 'false', limit: '5' })
    expect(argsOf(w.ran[0])).toEqual({ title: 'x', draft: false, limit: 5 })
    expect(result.context?.join('\n')).toContain('draft: "false" → false (boolean)')
    expect(result.context?.join('\n')).toContain('limit: "5" → 5 (number)')
  })

  test('a single value becomes a list, a JSON string an object', async ($, on) => {
    const w = world(on, { [SCHEMA_FILE]: schemaFile() })
    await $.session.start(START)
    await call($, { tool: 'mcp__notes__create', title: 'x', labels: 'bug', meta: '{"pinned":"true"}' })
    expect(argsOf(w.ran[0])).toEqual({ title: 'x', labels: ['bug'], meta: { pinned: true } })
  })

  test('unknown keys are dropped only when the schema forbids them', async ($, on) => {
    const w = world(on, { [SCHEMA_FILE]: schemaFile() })
    await $.session.start(START)
    const closed = await call($, { tool: 'mcp__notes__create', title: 'x', colour: 'red' })
    expect(argsOf(w.ran[0])).toEqual({ title: 'x' })
    expect(closed.context?.join('\n')).toContain('colour: dropped')

    const open = await call($, { tool: 'mcp__notes__search', query: 'x', colour: 'red' })
    expect(argsOf(w.ran[1])).toEqual({ query: 'x', colour: 'red' })
    expect(open.context).toBeUndefined()
  })

  test('valid input is a pure pass-through: no change, no note', async ($, on) => {
    const w = world(on, { [SCHEMA_FILE]: schemaFile() })
    await $.session.start(START)
    const input = { title: 'true', draft: true, limit: 3, labels: ['a'], meta: { pinned: false } }
    const result = await call($, { tool: 'mcp__notes__create', ...input })
    expect(argsOf(w.ran[0])).toEqual(input)
    expect(result.context).toBeUndefined()
    expect(w.statuses.filter(text => text !== undefined)).toEqual([])
  })

  test('subagent calls are repaired too', async ($, on) => {
    const w = world(on, { [SCHEMA_FILE]: schemaFile() })
    await $.session.start(START)
    await call($, { tool: 'mcp__notes__create', title: 'x', draft: 'true', agentId: 'agent-1' })
    expect(argsOf(w.ran[0])).toEqual({ title: 'x', draft: true })
  })

  test('built-in tools and unknown MCP tools are untouched', async ($, on) => {
    const w = world(on, { [SCHEMA_FILE]: schemaFile() })
    await $.session.start(START)
    await call($, { tool: 'mcp__other__thing', flag: 'true' })
    expect(argsOf(w.ran[0])).toEqual({ flag: 'true' })
  })

  test('the status line counts fixes', async ($, on) => {
    const w = world(on, { [SCHEMA_FILE]: schemaFile() })
    await $.session.start(START)
    await call($, { tool: 'mcp__notes__create', title: 'x', draft: 'true' })
    expect(w.statuses.at(-1)).toBe('MENDER ▸ 1 FIXED')
  })

  test('/mender off is a pure pass-through until /mender on', async ($, on) => {
    const w = world(on, { [SCHEMA_FILE]: schemaFile() })
    await $.session.start(START)
    await $.command.run(run('off'))
    await call($, { tool: 'mcp__notes__create', title: 'x', draft: 'true' })
    expect(argsOf(w.ran[0])).toEqual({ title: 'x', draft: 'true' })
    await $.command.run(run('on'))
    await call($, { tool: 'mcp__notes__create', title: 'x', draft: 'true' })
    expect(argsOf(w.ran[1])).toEqual({ title: 'x', draft: true })
  })

  test('/mender off adds no notes, toasts or bookkeeping, even on errors', async ($, on) => {
    const w = world(on, { [SCHEMA_FILE]: schemaFile() })
    await $.session.start(START)
    await $.command.run(run('off'))
    w.answers.push({ error: 'MCP server "notes" is not connected' }, { error: ZOD_ERROR })
    const down = await call($, { tool: 'mcp__notes__search', query: 'x' })
    const invalid = await call($, { tool: 'mcp__wiki__search', limit: '5' })
    expect(down.context).toBeUndefined()
    expect(invalid.context).toBeUndefined()
    expect(w.toasts).toEqual([])
    expect(w.store.learned).toBeUndefined()
    expect((await $.command.run(run('list'))).text).toMatch(/no schema errors/i)
  })
})

describe('schema errors that still come back', () => {
  test('are recorded per tool and teach mender the shape for the next call', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answers.push({ error: ZOD_ERROR })
    const first = await call($, { tool: 'mcp__wiki__search', query: 'x', limit: '5', colour: 'red' })
    expect(first.isError).toBe(true)
    const note = first.context?.join('\n') ?? ''
    expect(note).toContain('limit must be number')
    expect(note).toContain('{"query":"x","limit":5}')

    const listing = await $.command.run(run('list'))
    expect(listing.text).toContain('wiki/search')
    expect(listing.text).toMatch(/x1/)

    const second = await call($, { tool: 'mcp__wiki__search', query: 'y', limit: '7', colour: 'blue' })
    expect(argsOf(w.ran[1])).toEqual({ query: 'y', limit: 7 })
    expect(second.context?.join('\n')).toContain('limit: "7" → 7 (number)')
    expect(w.store.learned).toBeDefined()
  })

  test('learned shapes outlive the session through the store', async ($, on) => {
    const learned = { mcp__wiki__search: { type: 'object', properties: { limit: { type: 'number' } } } }
    const w = world(on, {}, { learned })
    await $.session.start(START)
    await call($, { tool: 'mcp__wiki__search', limit: '3' })
    expect(argsOf(w.ran[0])).toEqual({ limit: 3 })
  })

  test('a schema error that keeps coming back is counted per tool', async ($, on) => {
    const w = world(on, { [SCHEMA_FILE]: schemaFile() })
    await $.session.start(START)
    w.answers.push({ error: 'Invalid params: data/title must be string' }, { error: 'Invalid params: data/title must be string' })
    await call($, { tool: 'mcp__notes__create', title: 3 })
    await call($, { tool: 'mcp__notes__create', title: 4 })
    const listing = await $.command.run(run('list'))
    expect(listing.text).toMatch(/x2 +notes\/create/)
    expect(w.statuses.at(-1)).toBe('MENDER ▸ 2 ERR')
  })

  test('/mender forget drops what was learned', async ($, on) => {
    const learned = { mcp__wiki__search: { type: 'object', properties: { limit: { type: 'number' } } } }
    const w = world(on, {}, { learned })
    await $.session.start(START)
    const text = (await $.command.run(run('forget'))).text
    expect(text).toMatch(/forgot 1/i)
    await call($, { tool: 'mcp__wiki__search', limit: '3' })
    expect(argsOf(w.ran[0])).toEqual({ limit: '3' })
    expect(w.store.learned).toEqual({})
  })

  test('a tool in the schema file also uses what its errors taught', async ($, on) => {
    const w = world(on, { [SCHEMA_FILE]: schemaFile() })
    await $.session.start(START)
    w.answers.push({ error: ZOD_ERROR })
    const first = await call($, { tool: 'mcp__notes__search', query: 'x', limit: 2, colour: 'red' })
    expect(first.context?.join('\n')).toContain('{"query":"x","limit":2}')
    const second = await call($, { tool: 'mcp__notes__search', query: 'y', limit: '3', colour: 'blue' })
    expect(argsOf(w.ran[1])).toEqual({ query: 'y', limit: 3 })
    expect(second.context?.join('\n')).toContain('colour: dropped')
  })

  test('ordinary tool errors are not recorded', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answers.push({ error: 'Note not found' })
    const result = await call($, { tool: 'mcp__wiki__get', id: 'x' })
    expect(result.context).toBeUndefined()
    expect((await $.command.run(run('list'))).text).toMatch(/no schema errors/i)
  })
})

describe('a connector that is down', () => {
  test('toasts once, attaches a stop-retrying note, clears on success', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answers.push({ error: 'MCP server "wiki" is not connected' }, { error: 'MCP server "wiki" is not connected' })
    const first = await call($, { tool: 'mcp__wiki__search', query: 'x' })
    const second = await call($, { tool: 'mcp__wiki__get', id: 'y' })
    expect(w.toasts.filter(text => text === 'MENDER ▸ WIKI DOWN')).toHaveLength(1)
    expect(first.context?.join('\n')).toMatch(/stop retrying/i)
    expect(second.context?.join('\n')).toMatch(/stop retrying/i)
    expect(w.statuses.at(-1)).toBe('MENDER ▸ 1 DOWN')

    await call($, { tool: 'mcp__wiki__search', query: 'x' })
    expect(w.statuses.at(-1)).toBeUndefined()
    w.answers.push({ error: '401 Unauthorized' })
    await call($, { tool: 'mcp__wiki__search', query: 'x' })
    expect(w.toasts.filter(text => text === 'MENDER ▸ WIKI DOWN')).toHaveLength(2)
  })

  test('ordinary errors and policy denies that mention 401 or unauthorized are not an outage', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answers.push(
      { error: 'Issue #401 was not found' },
      { error: 'Unauthorized to access repo private/x' },
      { deny: 'Unauthorized: writes to prod are blocked' },
    )
    const missing = await call($, { tool: 'mcp__notes__get', id: '401' })
    const forbidden = await call($, { tool: 'mcp__notes__get', id: 'x' })
    const denied = await call($, { tool: 'mcp__notes__delete', id: 'x' })
    expect(missing.context).toBeUndefined()
    expect(forbidden.context).toBeUndefined()
    expect(denied.deny).toBe('Unauthorized: writes to prod are blocked')
    expect(w.toasts).toEqual([])
  })

  test('a deny from below that says the server is down counts too', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answers.push({ deny: 'connect ECONNREFUSED 127.0.0.1:8931' })
    const result = await call($, { tool: 'mcp__wiki__search', query: 'x' })
    expect(result.deny).toMatch(/ECONNREFUSED/)
    expect(result.deny).toMatch(/stop retrying/i)
    expect(w.toasts).toContain('MENDER ▸ WIKI DOWN')
  })
})

describe('commands and the schema file', () => {
  test('session.start registers /mender and loads the schema file', async ($, on) => {
    const w = world(on, { [SCHEMA_FILE]: schemaFile() })
    await $.session.start(START)
    expect(w.commands).toEqual(['mender'])
    const text = (await $.command.run(run('list'))).text
    expect(text).toMatch(/2 tools from the schema file/i)
  })

  test('a bad schema file toasts once and never crashes', async ($, on) => {
    const w = world(on, { [SCHEMA_FILE]: '{ not json' })
    await $.session.start(START)
    expect(w.toasts.some(text => /SCHEMA FILE/.test(text))).toBe(true)
    await call($, { tool: 'mcp__notes__create', title: 'x', draft: 'true' })
    expect(argsOf(w.ran[0])).toEqual({ title: 'x', draft: 'true' })
  })

  test('a custom schema file path from userConfig, ~ expanded', { options: { schemaFile: '~/schemas/mcp.json' } }, async ($, on) => {
    const w = world(on, { [`/home/dev/schemas/mcp.json`]: schemaFile() })
    await $.session.start(START)
    await call($, { tool: 'mcp__notes__create', title: 'x', draft: 'true' })
    expect(argsOf(w.ran[0])).toEqual({ title: 'x', draft: true })
  })

  test('learning can be switched off', { options: { learn: false } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answers.push({ error: ZOD_ERROR })
    await call($, { tool: 'mcp__wiki__search', limit: '5' })
    await call($, { tool: 'mcp__wiki__search', limit: '5' })
    expect(argsOf(w.ran[1])).toEqual({ limit: '5' })
    expect(w.store.learned).toBeUndefined()
  })

  test('/mender reload re-reads the schema file', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.files[SCHEMA_FILE] = schemaFile()
    await $.command.run(run('reload'))
    await call($, { tool: 'mcp__notes__create', title: 'x', draft: 'true' })
    expect(argsOf(w.ran[0])).toEqual({ title: 'x', draft: true })
  })

  test('/mender opens the pane; unknown verbs print usage', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.command.run(run(''))
    expect(w.opened.map(pane => pane.id)).toEqual(['mender'])
    expect((await $.command.run(run('what'))).text).toMatch(/usage/)
  })
})
