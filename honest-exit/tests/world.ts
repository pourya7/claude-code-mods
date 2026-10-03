// A fake world beneath honest-exit for register and UI tests: a Bash tool
// whose next answer the test sets, a clock, and recorders for toasts,
// statuses, panes and the commands that actually ran.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export type Answer =
  | { kind: 'ok'; stdout: string; stderr?: string; backgroundTaskId?: string }
  | { kind: 'error'; text: string }
  | { kind: 'deny'; reason: string }

export type World = {
  toasts: string[]
  statuses: (string | undefined)[]
  opened: { id: string; title?: string }[]
  commands: string[]
  ran: Record<string, unknown>[]
  /** What the Bash tool answers next (and after). */
  answer: Answer
  clock: ReturnType<typeof mock.clock>
}

export const world = (on: On): World => {
  const state: World = {
    toasts: [],
    statuses: [],
    opened: [],
    commands: [],
    ran: [],
    answer: { kind: 'ok', stdout: '' },
    clock: mock.clock(on, { now: Date.UTC(2026, 9, 3, 12, 0) }),
  }
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
    const answer = state.answer
    if (answer.kind === 'deny') return { deny: answer.reason }
    if (answer.kind === 'error') return { isError: true, result: answer.text, text: answer.text } as never
    const result: Record<string, unknown> = { stdout: answer.stdout, stderr: answer.stderr ?? '', interrupted: false }
    if (answer.backgroundTaskId !== undefined) result.backgroundTaskId = answer.backgroundTaskId
    return { result } as never
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  return state
}

export const START = { cwd: '/work/app', surface: 'terminal', isInteractive: true } as const

export const run = (args = '') => ({
  command: 'honest-exit',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})

export const PANE_PROPS = {
  title: 'HONEST EXIT',
  isFocused: true,
  bodyColumns: 72,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

export const SURFACES = ['terminal', 'desktop'] as const
