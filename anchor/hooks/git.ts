import { baseName, parentOf, resolvePath } from './paths'

export type GitDirs = { root: string; primary: string | null }

/** The argv anchor runs to learn where a directory sits in git. */
export const REV_PARSE = [
  'git',
  'rev-parse',
  '--path-format=absolute',
  '--git-dir',
  '--git-common-dir',
  '--show-toplevel',
] as const

/** The argv for a directory's path with symlinks resolved, the spelling git prints. */
export const REAL_PWD = ['pwd', '-P'] as const

/** The argv for the checked-out branch (empty output when detached). */
export const SHOW_BRANCH = ['git', 'branch', '--show-current'] as const

/**
 * Reads `git rev-parse --git-dir --git-common-dir --show-toplevel` output.
 * A linked worktree has a git dir apart from the common one; the common
 * dir's parent is the primary checkout (only when it is a `.git` folder:
 * a bare repository has no checkout to protect).
 */
export const readGitDirs = (stdout: string, cwd: string): GitDirs => {
  const [gitDir, commonDir, topLevel] = stdout.split('\n').map(line => line.trim())
  if (!gitDir || !commonDir) return { root: cwd, primary: null }

  const git = resolvePath(gitDir, cwd)
  const common = resolvePath(commonDir, cwd)
  const root = topLevel ? resolvePath(topLevel, cwd) : cwd
  const isLinked = git !== common && baseName(common) === '.git'

  return { root, primary: isLinked ? parentOf(common) : null }
}
