import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { PartyMember } from '../types'

export const NOW = Date.UTC(2026, 9, 3, 12, 0)
export const SELF = 'self-session'
export const START = { cwd: '/work/app', surface: 'terminal', isInteractive: true } as const
export const PANE_PROPS = {
  title: 'PARTY',
  isFocused: false,
  bodyColumns: 70,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

export type World = {
  store: Record<string, unknown>
  /** What `$.session.id()` answers (a /clear changes it). */
  sessionId: string
  toasts: string[]
  statuses: (string | undefined)[]
  opened: string[]
  sent: { to: string; text: string }[]
  copied: string[]
  ran: string[]
  /** Session ids `session.send` refuses. */
  unreachable: Set<string>
  /** Holds the bottom tool.call open this long (a dialog awaiting the person). */
  holdMs: number
  /** Per Bash command, how long its bottom tool.call is held instead of holdMs. */
  holdBy: Record<string, number>
  /** The tool_use_id of every call that reached the bottom, by Bash command or tool name. */
  ids: Record<string, string>
  /** When set, the bottom tool.call refuses with this reason (the person said no). */
  deny: string | null
  /** What the engine's own permission decision answers beneath party. */
  check: { decision: 'allow' | 'ask' | 'deny'; reason?: string }
  clock: ReturnType<typeof mock.clock>
}

/** Another session's heartbeat, as it would sit in the shared store. */
export function other(over: Partial<PartyMember> = {}): PartyMember {
  return {
    sessionId: 'other-session',
    title: 'ship the release',
    cwd: '/work/app-two',
    branch: 'feat/release',
    repo: 'example/app',
    state: 'working',
    since: NOW,
    waitingFor: null,
    lastTool: 'Bash',
    beatAt: NOW,
    touches: [],
    ...over,
  }
}

/** The engine beneath party: a shared store in memory, git, gh-free tool bottom, sends and copies recorded. */
export function world(on: On, store: Record<string, unknown> = {}): World {
  const w: World = {
    store: { ...store },
    sessionId: SELF,
    toasts: [],
    statuses: [],
    opened: [],
    sent: [],
    copied: [],
    ran: [],
    unreachable: new Set(),
    holdMs: 0,
    holdBy: {},
    ids: {},
    deny: null,
    check: { decision: 'allow' },
    clock: mock.clock(on, { now: NOW }),
  }
  on('store.get', ($, e) => ({ value: w.store[e.key] }))
  on('store.set', ($, e) => {
    w.store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    delete w.store[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(w.store) }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: w.sessionId }))
  on('session.repo', () => ({ value: { root: '/work/app', remote: 'git@github.com:example/app.git', internal: false, name: null } }))
  on('process.run', ($, e) => {
    const argv = e.argv.join(' ')
    if (argv.includes('rev-parse --abbrev-ref HEAD')) return { value: { exitCode: 0, stdout: 'feat/login\n', stderr: '' } }
    return { value: { exitCode: 1, stdout: '', stderr: 'unexpected' } }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }) as never)
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.copy', ($, e) => {
    w.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('session.send', ($, e) => {
    const isRefused = [...w.unreachable].some(id => e.to.includes(id))
    if (isRefused) return { isDelivered: false, reason: 'the recipient is not running' }
    w.sent.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  on('tool.check', () => w.check)
  on('tool.call', async ($, e) => {
    const name = e.tool === 'Bash' ? e.command : e.tool
    if (e.tool === 'Bash') w.ran.push(e.command)
    w.ids[name] = e.tool_use_id
    const hold = w.holdBy[name] ?? w.holdMs
    if (hold > 0) await w.clock.sleep(hold)
    if (w.deny !== null) return { deny: w.deny }
    return { result: { stdout: 'ok', stderr: '', interrupted: false } } as never
  })
  return w
}

export async function start($: Engine) {
  await $.session.start(START)
}

let turns = 0
export async function turnStart($: Engine, text = 'fix the login page') {
  await $.turn.start({ text, turnId: `t${(turns += 1)}` })
}

export async function turnEnd($: Engine) {
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: `t${turns}`, reason: 'answer' })
}

export const selfEntry = (w: World) => w.store[`session:${SELF}`] as PartyMember | undefined
