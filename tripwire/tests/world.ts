// A fake world beneath the plugin for register/ui tests: files in memory, a
// store, a clock, HOME, the project root, and recorders for toasts and panes.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export const HOME = '/home/dev'
export const ROOT = '/work/app'
export const USER_FILE = `${HOME}/.claude/tripwire.json`
export const PROJECT_FILE = `${ROOT}/.claude/tripwire.json`

export const FORCE_RULE = {
  id: 'no-force-push',
  tool: 'Bash',
  match: 'git push .*--force(?!-with-lease)',
  field: 'command',
  action: 'deny',
  message: 'Force pushes rewrite shared history.',
  cite: 'memory/never-force-push.md',
}

export const ASK_RULE = {
  id: 'protected-host',
  tool: '*',
  match: 'api\\.example\\.com',
  action: 'ask',
  message: 'Protected host.',
}

export const REWRITE_RULE = {
  id: 'pnpm-not-npm',
  tool: 'Bash',
  match: '\\bnpm install\\b',
  field: 'command',
  action: 'rewrite',
  replace: 'pnpm install',
  message: 'This repo uses pnpm.',
}

export const NOTE_RULE = {
  id: 'checks-after-push',
  tool: 'Bash',
  match: 'gh pr checks',
  field: 'command',
  action: 'note',
  message: 'Checks lag a push; confirm the head SHA.',
}

export type World = {
  files: Record<string, string>
  store: Record<string, unknown>
  writes: { path: string; text: string }[]
  toasts: string[]
  statuses: (string | undefined)[]
  opened: { id: string; title?: string }[]
  commands: string[]
  ran: Record<string, unknown>[]
  /** When set, the tool bottom refuses every call with this text. */
  toolDeny?: string
  clock: ReturnType<typeof mock.clock>
}

export const BASH_OK = { result: { stdout: 'ok', stderr: '', interrupted: false } }

/** Registers the world's hooks on the test's `on`; the tool bottom records each call it runs. */
export const world = (
  on: On,
  files: Record<string, string> = {},
  store: Record<string, unknown> = {},
  check: { decision: 'allow' | 'ask' | 'deny'; reason?: string } = { decision: 'allow' },
): World => {
  const state: World = {
    files: { ...files },
    store: { ...store },
    writes: [],
    toasts: [],
    statuses: [],
    opened: [],
    commands: [],
    ran: [],
    clock: mock.clock(on, { now: Date.UTC(2026, 9, 3, 12, 0) }),
  }
  on('store.get', ($, e) => ({ value: state.store[e.key] }))
  on('store.set', ($, e) => {
    state.store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  mock.env(on, { HOME })
  on('session.root', () => ({ value: ROOT }))
  on('fs.exists', ($, e) => ({ value: e.path in state.files }))
  on('fs.read', ($, e) => {
    const text = state.files[e.path]
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', ($, e) => {
    state.files[e.path] = e.text
    state.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
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
    if (state.toolDeny !== undefined) return { deny: state.toolDeny }
    state.ran.push({ ...e })
    return BASH_OK as never
  })
  on('tool.check', () => check)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  return state
}

export const ruleFile = (...rules: unknown[]) => JSON.stringify({ rules }, null, 2)

export const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const

export const run = (args = '') => ({
  command: 'tripwire',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})

export const PANE_PROPS = {
  title: 'TRAPS ARMED',
  isFocused: true,
  bodyColumns: 72,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

export const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100 }

export const SURFACES = ['terminal', 'desktop'] as const
