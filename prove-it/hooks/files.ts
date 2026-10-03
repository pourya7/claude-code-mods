// Which changed files are tests and which are the fix, plus the small parsers
// for git output and the test command.

export const DEFAULT_TEST_GLOBS = ['**/*.test.*', '**/*_test.*', '**/test_*.py', 'tests/**'] as const

/** A path glob: `*` and `?` stay inside one folder, `**` crosses folders (and may match none). */
export const globToRegExp = (glob: string): RegExp => {
  let pattern = ''
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i] as string
    if (char === '*' && glob[i + 1] === '*') {
      const isFolder = glob[i + 2] === '/'
      pattern += isFolder ? '(?:.*/)?' : '.*'
      i += isFolder ? 2 : 1
    } else if (char === '*') {
      pattern += '[^/]*'
    } else if (char === '?') {
      pattern += '[^/]'
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }

  return new RegExp(`^${pattern}$`)
}

/** A userConfig glob list: comma or blank separated. */
export const parseGlobList = (text: unknown): string[] =>
  typeof text === 'string' ? text.split(/[\s,]+/).filter(word => word !== '') : []

const matchesAny = (path: string, globs: readonly RegExp[]): boolean => globs.some(glob => glob.test(path))

/** Splits changed paths into tests and sources; with no source globs every non-test is a source. */
export const classifyFiles = (
  paths: readonly string[],
  testGlobs: readonly string[],
  sourceGlobs: readonly string[],
): { tests: string[]; sources: string[] } => {
  const tests = testGlobs.map(globToRegExp)
  const sources = sourceGlobs.map(globToRegExp)
  const isTest = (path: string) => matchesAny(path, tests)
  const isSource = (path: string) => !isTest(path) && (sources.length === 0 || matchesAny(path, sources))

  return { tests: paths.filter(isTest), sources: paths.filter(isSource) }
}

/** `git ... -z` output: NUL-separated names, in order, each once. */
export const parseNulList = (text: string): string[] => [...new Set(text.split('\0').filter(name => name !== ''))]

/** The test command as an argument vector (no shell): blanks split, quotes group. */
export const splitCommand = (command: string): string[] => {
  const words: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (const match of command.matchAll(pattern)) words.push(match[1] ?? match[2] ?? match[3] ?? '')

  return words
}
