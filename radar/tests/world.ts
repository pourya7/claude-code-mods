// A fake world beneath radar for register and UI tests: memory files in
// memory, HOME, settings, the project root, and recorders for what radar shows.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export const HOME = '/home/dev'
export const ROOT = '/work/app'
export const DEFAULT_DIR = `${HOME}/.claude/projects/-work-app/memory`

export const memoryFile = (name: string, description: string, extra = '', body = '') =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n${body}`

export const DIRTY = memoryFile(
  'Never checkout a dirty file',
  'copy it aside first',
  "triggers:\n  - 'git checkout --\\s'\n",
  '- Never run `git checkout -- <file>` on a dirty file.\n- Always copy it aside first.\n',
)
export const DOCKER = memoryFile('Docker stack capacity', 'one compose stack per worktree fits the docker vm')
export const FORCE = memoryFile('Force push', 'never force push shared branches', '', 'Must use --force-with-lease.\n')
export const INDEX = '# Memory index\n- [Dirty](dirty.md)\n'

export const STARTER = {
  [`${DEFAULT_DIR}/MEMORY.md`]: INDEX,
  [`${DEFAULT_DIR}/dirty.md`]: DIRTY,
  [`${DEFAULT_DIR}/docker.md`]: DOCKER,
  [`${DEFAULT_DIR}/force.md`]: FORCE,
}

export type World = {
  files: Record<string, string>
  settings: Record<string, unknown>
  writes: string[]
  toasts: string[]
  statuses: (string | undefined)[]
  opened: { id: string; title?: string }[]
  commands: string[]
  ran: Record<string, unknown>[]
  toolDeny?: string
  clock: ReturnType<typeof mock.clock>
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/'))

export const world = (on: On, files: Record<string, string> = STARTER, settings: Record<string, unknown> = {}): World => {
  const state: World = {
    files: { ...files },
    settings: { ...settings },
    writes: [],
    toasts: [],
    statuses: [],
    opened: [],
    commands: [],
    ran: [],
    clock: mock.clock(on, { now: new Date(2026, 9, 3, 9, 5).getTime() }),
  }
  mock.env(on, { HOME })
  on('session.root', () => ({ value: ROOT }))
  on('settings.read', () => ({ value: state.settings }))
  on('fs.list', ($, e) => {
    const dir = e.path.replace(/\/$/, '')
    const names = Object.keys(state.files).filter(path => dirOf(path) === dir)
    const subdirs = new Set(
      Object.keys(state.files)
        .filter(path => path.startsWith(`${dir}/`) && dirOf(path) !== dir)
        .map(path => path.slice(dir.length + 1).split('/')[0] ?? ''),
    )
    if (names.length === 0 && subdirs.size === 0) return { deny: `ENOENT: ${e.path}` }
    return {
      value: [
        ...names.map(path => ({ name: path.slice(dir.length + 1), kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false })),
        ...[...subdirs].map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })),
      ],
    }
  })
  on('fs.read', ($, e) => {
    const text = state.files[e.path]
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', ($, e) => {
    state.writes.push(e.path)
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
    return { result: { stdout: 'ok', stderr: '', interrupted: false } } as never
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  return state
}

export const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const

export const run = (args = '') => ({
  command: 'radar',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})

export const PANE_PROPS = {
  title: 'RADAR',
  isFocused: true,
  bodyColumns: 72,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

export const SURFACES = ['terminal', 'desktop'] as const
