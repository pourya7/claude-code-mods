// A fake world beneath mender: files in memory, a store, HOME, a clock,
// recorders for toasts, statuses and panes, and an MCP "server" at the tool
// bottom that answers each call from a script.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export const HOME = '/home/dev'
export const SCHEMA_FILE = `${HOME}/.claude/mender/schemas.json`

export const NOTE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    draft: { type: 'boolean' },
    limit: { type: 'integer' },
    labels: { type: 'array', items: { type: 'string' } },
    meta: { type: 'object', properties: { pinned: { type: 'boolean' } } },
  },
  required: ['title'],
  additionalProperties: false,
}

export const OPEN_SCHEMA = {
  type: 'object',
  properties: { query: { type: 'string' }, limit: { type: 'number' } },
}

export const schemaFile = () =>
  JSON.stringify({ mcp__notes__create: NOTE_SCHEMA, mcp__notes__search: OPEN_SCHEMA }, null, 2)

/** What the bottom answers: ok, or an error text the "server" returns. */
export type Answer = { ok: true } | { error: string } | { deny: string }

export type World = {
  files: Record<string, string>
  store: Record<string, unknown>
  toasts: string[]
  statuses: (string | undefined)[]
  opened: { id: string; title?: string }[]
  commands: string[]
  /** Every call that reached the tool bottom, as it arrived. */
  ran: Record<string, unknown>[]
  /** Answers for the next calls, in order; empty means ok. */
  answers: Answer[]
  clock: ReturnType<typeof mock.clock>
}

export const world = (on: On, files: Record<string, string> = {}, store: Record<string, unknown> = {}): World => {
  const state: World = {
    files: { ...files },
    store: { ...store },
    toasts: [],
    statuses: [],
    opened: [],
    commands: [],
    ran: [],
    answers: [],
    clock: mock.clock(on, { now: Date.UTC(2026, 9, 3, 12, 0) }),
  }
  on('store.get', ($, e) => ({ value: state.store[e.key] }))
  on('store.set', ($, e) => {
    state.store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    delete state.store[e.key]
    return { value: undefined }
  })
  mock.env(on, { HOME })
  on('fs.exists', ($, e) => ({ value: e.path in state.files }))
  on('fs.read', ($, e) => {
    const text = state.files[e.path]
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('ui.toast', ($, e) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    state.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    state.opened.push({ id: e.id, title: e.title })
    return { value: { isPlaced: true } }
  })
  on('command.register', ($, e) => {
    state.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('tool.call', ($, e) => {
    state.ran.push({ ...e })
    const answer = state.answers.shift() ?? { ok: true }
    if ('deny' in answer) return { deny: answer.deny }
    if ('error' in answer) {
      return { result: { content: [{ type: 'text', text: answer.error }], isError: true }, text: answer.error, isError: true } as never
    }
    return { result: { content: [{ type: 'text', text: 'ok' }] }, text: 'ok' } as never
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  return state
}

/** The arguments a call reached the bottom with, without the envelope. */
export const argsOf = (call: Record<string, unknown> | undefined) => {
  if (call === undefined) return undefined
  const { tool, tool_use_id, agentId, ...args } = call
  return args
}

export const START = { cwd: '/work/app', surface: 'terminal', isInteractive: true } as const

export const run = (args = '') => ({
  command: 'mender',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})

export const PANE_PROPS = {
  title: 'MENDER',
  isFocused: true,
  bodyColumns: 72,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

export const SURFACES = ['terminal', 'desktop'] as const

export const ZOD_ERROR = `MCP error -32602: Input validation error: Invalid arguments for tool search: [
  { "code": "invalid_type", "expected": "number", "received": "string", "path": ["limit"], "message": "Expected number, received string" },
  { "code": "unrecognized_keys", "keys": ["colour"], "path": [], "message": "Unrecognized key(s) in object: 'colour'" }
]`
