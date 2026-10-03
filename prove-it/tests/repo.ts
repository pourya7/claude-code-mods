// A fake git repository beneath prove-it: a working tree, the files at the
// merge base, and a test command whose result depends on the tree. It answers
// every argv prove-it runs, and records them, so tests can check what ran.

export const ROOT = '/work/app'
export const TMP = '/tmp/t'
export const BASE_SHA = 'b4se000111222333444555666777888999aaabbb'
export const GIT_DIR = `${ROOT}/.git`
export const LOCK = `${GIT_DIR}/prove-it.lock`
export const HEAD_SHA = '4ead000111222333444555666777888999aaabbb'

export const BUGGY = 'export const add = (a, b) => a - b\n'
export const FIXED = 'export const add = (a, b) => a + b\n'
export const TEST = "test('adds', () => expect(add(1, 2)).toBe(3))\n"

export type Output = { exitCode: number; stdout: string; stderr: string }

export type Repo = {
  /** The working tree (and the temp dir), by absolute path. */
  files: Map<string, string>
  /** Tracked files at the merge base, by repository-relative path. */
  base: Map<string, string>
  /** Untracked, not ignored files, repository-relative. */
  untracked: Set<string>
  /** Folders made with mkdir (no -p), by absolute path: the lock lives here. */
  dirs: Set<string>
  /** Every argv run, in order. */
  ran: string[][]
  /** The test command's verdict on the tree as it stands: an exit code, or a throw. */
  judge: (files: Map<string, string>) => number
  /** When set, copying back from the temp dir writes this instead (a bad restore). */
  corruptRestore?: string
  /** When set, the test command cannot start on its nth run (1-based). */
  failToStartOnRun?: number
  /** When set, `git rev-parse --show-toplevel` fails. */
  isNotARepo?: boolean
  testRuns: number
  /** What the tree held each time the test command ran. */
  treeAtTestRun: Map<string, string>[]
}

const ok = (stdout = ''): Output => ({ exitCode: 0, stdout, stderr: '' })
const failed = (stderr: string, exitCode = 128): Output => ({ exitCode, stdout: '', stderr })

const relative = (path: string): string => (path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path)

/** The tree's tracked paths: everything under ROOT that is not untracked. */
const tracked = (repo: Repo): string[] =>
  [...repo.files.keys()]
    .filter(path => path.startsWith(`${ROOT}/`))
    .map(relative)
    .filter(path => !repo.untracked.has(path))

/**
 * What git diff lists. Like git's default rename detection, a base file that
 * is gone while a new file holds its exact text is listed by the new path
 * only, unless `--no-renames` is given.
 */
const changedPaths = (repo: Repo, hasRenames = false): string[] => {
  const paths = new Set<string>()
  const added = tracked(repo).filter(path => !repo.base.has(path))
  for (const path of tracked(repo)) if (repo.base.get(path) !== repo.files.get(`${ROOT}/${path}`)) paths.add(path)
  for (const [path, text] of repo.base) {
    if (repo.files.has(`${ROOT}/${path}`)) continue
    const isRenamed = added.some(other => repo.files.get(`${ROOT}/${other}`) === text)
    if (!hasRenames || !isRenamed) paths.add(path)
  }
  return [...paths].sort()
}

/** A plain fix: src/add.ts goes from BUGGY to FIXED and src/add.test.ts is new. */
export const makeRepo = (overrides: Partial<Repo> = {}): Repo => ({
  files: new Map([
    [`${ROOT}/src/add.ts`, FIXED],
    [`${ROOT}/src/add.test.ts`, TEST],
    [`${ROOT}/README.md`, '# app\n'],
  ]),
  base: new Map([
    ['src/add.ts', BUGGY],
    ['README.md', '# app\n'],
  ]),
  untracked: new Set(),
  dirs: new Set(),
  ran: [],
  judge: files => (files.get(`${ROOT}/src/add.ts`) === FIXED ? 0 : 1),
  testRuns: 0,
  treeAtTestRun: [],
  ...overrides,
})

export const TEST_COMMAND = ['npm', 'test', '--']

/** Answers one argv the way git, cp, mkdir, rm and the test command would. */
export const runIn = (repo: Repo, argv: readonly string[]): Output => {
  repo.ran.push([...argv])
  const [command, ...args] = argv
  // Rename detection is on unless --no-renames is given, as in git.
  const hasRenames = !args.includes('--no-renames')
  const words = args.filter(arg => arg !== '--no-renames').join(' ')

  if (command === 'git') {
    if (words === 'rev-parse --show-toplevel') return repo.isNotARepo ? failed('fatal: not a git repository') : ok(`${ROOT}\n`)
    if (words === 'rev-parse --absolute-git-dir') return ok(`${GIT_DIR}\n`)
    if (words === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') return ok('origin/main\n')
    if (words.startsWith('rev-parse --verify --quiet')) return ok(`${BASE_SHA}\n`)
    if (words === 'merge-base HEAD origin/main' || words === 'merge-base HEAD main') return ok(`${BASE_SHA}\n`)
    if (words.startsWith('merge-base HEAD')) return failed('fatal: Not a valid object name')
    if (words === 'rev-parse HEAD') return ok(`${HEAD_SHA}\n`)
    if (words === `diff --name-only -z ${BASE_SHA}`) return ok(changedPaths(repo, hasRenames).map(path => `${path}\0`).join(''))
    if (words === `diff --no-ext-diff --binary ${BASE_SHA}`) {
      return ok(changedPaths(repo, hasRenames).map(path => `${path}:${repo.files.get(`${ROOT}/${path}`) ?? '<gone>'}`).join('\n'))
    }
    if (words === 'ls-files --others --exclude-standard -z') return ok([...repo.untracked].map(path => `${path}\0`).join(''))
    if (args[0] === 'show') {
      const path = (args[1] ?? '').replace(`${BASE_SHA}:`, '')
      const text = repo.base.get(path)
      return text === undefined ? failed(`fatal: path '${path}' does not exist in '${BASE_SHA}'`) : ok(text)
    }
    if (args[0] === 'hash-object') {
      const path = args[args.length - 1] ?? ''
      const text = repo.files.get(path)
      return text === undefined ? failed(`fatal: could not open '${path}'`) : ok(`hash(${text.length}:${text})\n`)
    }
    return failed(`unexpected git ${words}`)
  }
  if (command === 'mkdir') {
    if (args[0] === '-p') return ok()
    const dir = args[0] ?? ''
    if (repo.dirs.has(dir)) return failed(`mkdir: ${dir}: File exists`, 1)
    repo.dirs.add(dir)
    return ok()
  }
  if (command === 'rmdir') {
    const dir = args[0] ?? ''
    if (!repo.dirs.delete(dir)) return failed(`rmdir: ${dir}: No such file or directory`, 1)
    return ok()
  }
  if (command === 'cp') {
    const [from, to] = args.slice(-2) as [string, string]
    const text = repo.files.get(from)
    if (text === undefined) return failed(`cp: ${from}: No such file`, 1)
    const isRestore = from.startsWith(`${TMP}/`)
    repo.files.set(to, isRestore && repo.corruptRestore !== undefined ? repo.corruptRestore : text)
    return ok()
  }
  if (command === 'rm') {
    repo.files.delete(args[args.length - 1] ?? '')
    return ok()
  }
  if (argv.slice(0, TEST_COMMAND.length).join(' ') === TEST_COMMAND.join(' ')) {
    repo.testRuns += 1
    if (repo.failToStartOnRun === repo.testRuns) throw new Error('spawn npm ENOENT')
    repo.treeAtTestRun.push(new Map(repo.files))
    const exitCode = repo.judge(repo.files)
    return { exitCode, stdout: exitCode === 0 ? '1 passing\n' : '1 failing\n  adds: expected 3, got -1\n', stderr: '' }
  }
  return failed(`unexpected ${argv.join(' ')}`, 127)
}
