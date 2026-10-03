// A fake world beneath co-op for register/ui tests: a git that answers from a
// table, a model that answers from a queue, and recorders for everything the
// mod asks of the engine.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export const ROOT = '/work/app'
export const HOME = '/home/dev'

export const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

export const SMALL_DIFF = [
  'diff --git a/src/pay.ts b/src/pay.ts',
  '--- a/src/pay.ts',
  '+++ b/src/pay.ts',
  '@@ -40,3 +40,4 @@',
  ' export const refund = async (id: string) => {',
  '+  await charge(id)',
  ' }',
  '',
].join('\n')

export const PASS = JSON.stringify({ verdict: 'pass', findings: [] })
export const PASS_WITH_LOW = JSON.stringify({
  verdict: 'pass',
  findings: [{ severity: 'low', file: 'src/pay.ts', line: 41, summary: 'Name the retry count.' }],
})
export const FAIL_HIGH = JSON.stringify({
  verdict: 'fail',
  findings: [
    { severity: 'high', file: 'src/pay.ts', line: 41, summary: 'Refund charges the customer instead.' },
    { severity: 'low', file: 'src/pay.ts', summary: 'No log line.' },
  ],
})
export const FAIL_MEDIUM = JSON.stringify({
  verdict: 'fail',
  findings: [{ severity: 'medium', file: 'src/pay.ts', line: 41, summary: 'Retry is not idempotent.' }],
})

export type ModelAnswer = { text: string } | { error: string } | { throws: string }

export type ProcessCall = { argv: string[]; cwd?: string; stdin?: string; timeoutMs?: number }

export type World = {
  /** What `git diff <base>...HEAD` prints. */
  diff: string
  /** Refs that `git rev-parse --verify` accepts. */
  refs: string[]
  /** What `git symbolic-ref refs/remotes/origin/HEAD` prints; undefined = not set. */
  originHead?: string
  /** When set, `git diff` exits 128 with this stderr. */
  diffError?: string
  /** What the reviewer command prints, and its exit code. */
  commandOut: { exitCode: number; stdout: string; stderr: string }
  sessionModel: string
  answers: ModelAnswer[]
  modelCalls: { model: string; prompt: string; system?: string; timeoutMs?: number }[]
  processCalls: ProcessCall[]
  bash: { command: string; agentId?: string }[]
  toasts: string[]
  statuses: (string | undefined)[]
  opened: string[]
  commands: string[]
  clock: ReturnType<typeof mock.clock>
  /** Runs as each model call arrives, before it is answered (a test interrupts here). */
}

export const world = (on: On, over: Partial<World> = {}): World => {
  const state: World = {
    diff: SMALL_DIFF,
    refs: ['origin/main', 'main'],
    originHead: 'origin/main',
    commandOut: { exitCode: 0, stdout: PASS, stderr: '' },
    sessionModel: 'claude-opus-5-5',
    answers: [],
    modelCalls: [],
    processCalls: [],
    bash: [],
    toasts: [],
    statuses: [],
    opened: [],
    commands: [],
    clock: mock.clock(on, { now: Date.UTC(2026, 9, 3, 12, 0) }),
    ...over,
  }
  mock.env(on, { HOME })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: state.sessionModel }))
  on('command.register', ($, e) => {
    state.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    state.processCalls.push({ argv, cwd: e.init?.cwd, stdin: e.init?.stdin, timeoutMs: e.init?.timeoutMs })
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } })
    const no = (stderr = '') => ({ value: { exitCode: 1, stdout: '', stderr } })
    if (argv[0] === 'git' && argv[1] === 'symbolic-ref') {
      return state.originHead === undefined ? no() : ok(`${state.originHead}\n`)
    }
    if (argv[0] === 'git' && argv[1] === 'rev-parse') {
      const ref = (argv.at(-1) ?? '').replace(/\^\{commit\}$/, '')
      return state.refs.includes(ref) ? ok('0123456789abcdef\n') : no()
    }
    if (argv[0] === 'git' && argv[1] === 'diff') {
      return state.diffError === undefined
        ? ok(state.diff)
        : { value: { exitCode: 128, stdout: '', stderr: state.diffError } }
    }
    if (argv[0] === 'git') return no(`unexpected git call: ${argv.join(' ')}`)
    return { value: state.commandOut }
  })
  on('model.complete', ($, e) => {
    state.modelCalls.push({ model: e.model, prompt: e.prompt, system: e.system, timeoutMs: e.timeoutMs })
    const answer = state.answers.shift() ?? { text: PASS }
    if ('throws' in answer) return { deny: answer.throws }
    if ('error' in answer) {
      return { value: { isAnswered: false, reason: 'api-error', status: 529, error: answer.error, usage: USAGE } as never }
    }
    return { value: { isAnswered: true, text: answer.text, usage: USAGE } }
  })
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash') state.bash.push({ command: e.command, ...(e.agentId ? { agentId: e.agentId } : {}) })
    return { result: { stdout: 'https://github.com/acme/app/pull/42', stderr: '', interrupted: false } } as never
  })
  on('ui.render', () => ({ type: 'Box' }))
  on('ui.toast', ($, e) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    state.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    state.opened.push(e.id)
    return { value: { isPlaced: true } as never }
  })
  return state
}

export const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const

export const coop = (args = '') => ({
  command: 'coop',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})

export const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
}

export const PANE_PROPS = {
  title: '2P REVIEW',
  isFocused: true,
  bodyColumns: 72,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

export const SURFACES = ['terminal', 'desktop'] as const
