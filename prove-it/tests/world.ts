// The engine beneath prove-it in register and UI tests: the fake repository
// answers process.run and fs, plus recorders for status, toasts, commands and
// the Bash calls that actually ran.
import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ROOT, TMP, makeRepo, runIn } from './repo'
import type { Repo } from './repo'

export type World = {
  repo: Repo
  statuses: (string | undefined)[]
  toasts: string[]
  commands: string[]
  /** Bash commands that reached the tool. */
  bash: string[]
  /** process.run calls with the cwd each was given. */
  cwds: (string | undefined)[]
  /** When set, the test command waits for it before it answers. */
  hold?: Promise<void>
  /** When set, any argv it answers with a promise waits for that promise first. */
  holdFor?: (argv: readonly string[]) => Promise<void> | undefined
  clock: MockClock
}

export const world = (on: On, repo: Repo = makeRepo()): World => {
  const clock = mock.clock(on, { now: 1_000 })
  const seen: World = { repo, statuses: [], toasts: [], commands: [], bash: [], cwds: [], clock }
  mock.env(on, { TMPDIR: `${TMP}/` })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: ROOT }))
  on('command.register', (_$, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('process.run', async (_$, e) => {
    seen.cwds.push(e.init?.cwd)
    if (e.argv[0] === 'npm' && seen.hold !== undefined) await seen.hold
    const held = seen.holdFor?.(e.argv)
    if (held !== undefined) await held
    try {
      return { value: { ...runIn(seen.repo, e.argv), isStdoutTruncated: false, isStderrTruncated: false } }
    } catch (error) {
      return { deny: (error as Error).message }
    }
  })
  on('fs.write', (_$, e) => {
    seen.repo.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', (_$, e) => ({ value: seen.repo.files.has(e.path) }))
  on('ui.status', (_$, e) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Box' }))
  on('tool.call', (_$, e) => {
    if (e.tool === 'Bash') seen.bash.push(e.command)
    return { result: { stdout: 'ok', stderr: '', interrupted: false } } as never
  })
  return seen
}

export const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const

export const prove = (args = '') => ({
  command: 'prove',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})

export const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

/** A promise and the call that settles it, to hold a fake process until the test lets it go. */
export const gate = (): { promise: Promise<void>; open: () => void } => {
  let open = () => undefined as void
  const promise = new Promise<void>(resolve => {
    open = resolve
  })
  return { promise, open }
}

export const SURFACES = ['terminal', 'desktop'] as const

export const GATE = { options: { testCommand: 'npm test --', gate: true } }
export const NO_GATE = { options: { testCommand: 'npm test --' } }
