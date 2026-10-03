// A fake machine beneath dock: docker answering from fixtures, a disk that
// knows which directories exist, panes, the clipboard and the prompt box.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { COMPOSE_LS_JSON, EXISTING_DIRS, INFO_JSON, PS_LINES, STATS_LINES } from './fixtures'

export type Docker = 'ok' | 'missing' | 'daemon-down' | 'broken' | 'hung'

export type World = {
  docker: Docker
  /** Bytes in use reported by docker stats can be swapped per test. */
  stats: string
  info: string
  dirs: string[]
  runs: string[][]
  toasts: string[]
  opened: string[]
  panes: string[]
  copied: string[]
  filled: string[]
  /** What the person has typed in the prompt box. */
  draft: string
  copyWorks: boolean
  /** What the engine beneath decides at tool.check. */
  check: { decision: 'allow' | 'ask' | 'deny'; reason?: string }
  commands: string[]
  clock: ReturnType<typeof mock.clock>
}

export const SURFACES = ['terminal', 'desktop'] as const

export const START = { cwd: '/work/app', surface: 'terminal', isInteractive: true } as const

export const PANE_PROPS = {
  title: 'DOCK',
  isFocused: false,
  bodyColumns: 64,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 24 },
  view: {},
}

export const dockCommand = (args = '') => ({
  command: 'dock',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})

const DAEMON_DOWN = 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'

const answer = (world: World, argv: readonly string[]) => {
  if (world.docker === 'missing') throw new Error('spawn docker ENOENT')
  if (world.docker === 'daemon-down') return { exitCode: 1, stdout: '', stderr: DAEMON_DOWN }
  if (world.docker === 'broken') return { exitCode: 1, stdout: '', stderr: 'docker: something odd happened' }
  const verb = argv[1] === 'compose' ? `compose ${argv[2]}` : argv[1]
  const stdout =
    verb === 'info' ? world.info : verb === 'compose ls' ? COMPOSE_LS_JSON : verb === 'ps' ? PS_LINES : verb === 'stats' ? world.stats : null
  if (stdout === null) return { exitCode: 1, stdout: '', stderr: `unexpected: ${argv.join(' ')}` }
  return { exitCode: 0, stdout, stderr: '' }
}

export const world = (on: On, docker: Docker = 'ok'): World => {
  const state: World = {
    docker,
    stats: STATS_LINES,
    info: INFO_JSON,
    dirs: [...EXISTING_DIRS],
    runs: [],
    toasts: [],
    opened: [],
    panes: [],
    copied: [],
    filled: [],
    draft: '',
    copyWorks: true,
    check: { decision: 'allow' },
    commands: [],
    clock: mock.clock(on, { now: Date.UTC(2026, 9, 3, 12, 0) }),
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    state.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('process.run', ($, e) => {
    state.runs.push([...e.argv])
    // A docker that never answers: the probe stays outstanding.
    if (state.docker === 'hung') return new Promise<never>(() => {})
    return { value: { ...answer(state, e.argv), isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', async ($, e) => {
    return { value: state.dirs.includes(e.path) }
  })
  on('ui.toast', ($, e) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', ($, e) => {
    state.opened.push(e.id)
    if (!state.panes.includes(e.id)) state.panes.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    state.panes = state.panes.filter(id => id !== e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: state.panes.map(id => ({ id, title: id.toUpperCase(), isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('ui.copy', ($, e) => {
    if (!state.copyWorks) return { value: { isCopied: false, reason: 'no-clipboard' } }
    state.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('prompt.read', () => ({ value: { text: state.draft, cursor: state.draft.length } }))
  on('prompt.fill', ($, e) => {
    state.filled.push(e.text)
    state.draft = e.mode === 'replace' ? e.text : `${state.draft}${e.text}`
    return { isFilled: true }
  })
  on('tool.check', () => state.check)
  return state
}

/** True when every docker call the mod made only reads. */
export const onlyReads = (runs: readonly string[][]) =>
  runs.every(argv => {
    const verb = argv[1] === 'compose' ? `compose ${argv[2]}` : argv[1]
    return argv[0] === 'docker' && ['info', 'ps', 'stats', 'compose ls'].includes(verb ?? '')
  })
