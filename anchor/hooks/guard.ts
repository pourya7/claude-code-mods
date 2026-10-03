import { isInsideAny, resolvePath } from './paths'

/** The git verbs that change a checkout, its refs or its remote. */
export const WRITE_VERBS = [
  'commit',
  'checkout',
  'switch',
  'reset',
  'stash',
  'merge',
  'rebase',
  'push',
  'restore',
] as const

export type GitWrite = { verb: string; dir: string }

/** What ends a simple command: `&` backgrounds its whole list, the rest chain on. */
type End = 'sequence' | 'and-or' | 'pipe' | 'background' | 'group'

type Simple = { words: string[]; end: End }

/** Splits a command into simple commands on ;, &&, ||, |, &, ( ) and newlines, outside quotes. */
const splitCommands = (command: string): Simple[] => {
  const commands: Simple[] = []
  let words: string[] = []
  let word = ''
  let hasWord = false
  let quote: string | null = null

  const endWord = () => {
    if (hasWord) words.push(word)
    word = ''
    hasWord = false
  }
  const endCommand = (end: End) => {
    endWord()
    if (words.length > 0) commands.push({ words, end })
    else if (end === 'background' && commands.length > 0) (commands.at(-1) as Simple).end = end
    words = []
  }
  const addChar = (char: string) => {
    word += char
    hasWord = true
  }

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] as string
    const nextChar = command[index + 1]
    if (quote) {
      if (char === quote) quote = null
      else if (char === '\\' && quote === '"' && index + 1 < command.length) {
        index += 1
        word += command[index]
      } else word += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      hasWord = true
    } else if (char === '\\' && index + 1 < command.length) {
      index += 1
      addChar(command[index] as string)
    } else if (char === ' ' || char === '\t') endWord()
    else if (char === '&') {
      // `2>&1`, `>&2` and `&>file` are redirections, not separators.
      if (word.endsWith('>') || word.endsWith('<') || nextChar === '>') addChar(char)
      else if (nextChar === '&') {
        index += 1
        endCommand('and-or')
      } else endCommand('background')
    } else if (char === '|') {
      if (nextChar === '|') {
        index += 1
        endCommand('and-or')
      } else endCommand('pipe')
    } else if (char === ';' || char === '\n') endCommand('sequence')
    else if (char === '(' || char === ')') endCommand('group')
    else addChar(char)
  }
  endCommand('sequence')

  return commands
}

/** Shell words that run the command after them, in the same directory. */
const PREFIX_WORDS = new Set(['{', '}', '!', 'time', 'nohup', 'command', 'builtin', 'exec', 'env'])

/** Drops leading `NAME=value` assignments and wrappers (`command git`, `env X=1 git`). */
const unwrap = (words: string[]): string[] => {
  let index = 0
  while (index < words.length) {
    const word = words[index] as string
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || PREFIX_WORDS.has(word)) index += 1
    else if (index > 0 && word.startsWith('-') && PREFIX_WORDS.has(words[index - 1] as string)) index += 1
    else break
  }

  return words.slice(index)
}

/** `cd`/`pushd`'s directory, past `-L`/`-P`/`--`; null when it cannot be read (`~`, `-`, none). */
const cdTarget = (words: string[]): string | null => {
  let index = 1
  while (index < words.length && /^-[LPe@]+$|^--$/.test(words[index] as string)) index += 1
  const target = words[index]
  if (!target || target.startsWith('~') || target.startsWith('-') || target.startsWith('+')) return null

  return target
}

/** Git's global options that take a separate value. */
const OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

/** Reads one `git ...` simple command: the directory it acts on and its write verb, if any. */
const readGit = (words: string[], cwd: string): GitWrite | null => {
  let dir = cwd
  let index = 1
  while (index < words.length) {
    const word = words[index] as string
    if (!word.startsWith('-')) break
    if (word === '-C') dir = resolvePath(words[index + 1] ?? '.', dir)
    index += OPTIONS_WITH_VALUE.has(word) ? 2 : 1
  }
  const verb = words[index]
  const rest = words.slice(index + 1)
  if (verb === 'branch' && rest.includes('-D')) return { verb: 'branch -D', dir }
  if ((WRITE_VERBS as readonly string[]).includes(verb ?? '')) return { verb: verb as string, dir }

  return null
}

const asList = (paths: string | readonly string[]): readonly string[] =>
  typeof paths === 'string' ? [paths] : paths

/**
 * The first git write in `command` that lands in the primary checkout but
 * outside the anchored worktree, following `cd`, `pushd` and `git -C` from
 * `cwd`; null when there is none. `primary` and `root` may each be given in
 * several spellings (through a symlink and resolved).
 *
 * A list sent to the background with `&` runs in a subshell, so its `cd`
 * does not carry past the `&`.
 */
export const gitWriteTarget = (
  command: string,
  cwd: string,
  primary: string | readonly string[],
  root: string | readonly string[],
): GitWrite | null => {
  const primaries = asList(primary)
  const roots = asList(root)
  let here = cwd
  let listStart = cwd
  for (const { words: raw, end } of splitCommands(command)) {
    // A `{` group opens a list of its own: a `&` inside it backgrounds only its part.
    if (raw[0] === '{') listStart = here
    const words = unwrap(raw)
    const [head] = words
    if (head === 'cd' || head === 'pushd') {
      const target = cdTarget(words)
      if (target) here = resolvePath(target, here)
    } else if (head === 'git' || head?.endsWith('/git')) {
      const write = readGit(words, here)
      if (write && isInsideAny(write.dir, primaries) && !isInsideAny(write.dir, roots)) return write
    }
    if (end === 'background') here = listStart
    if (end === 'sequence' || end === 'background' || end === 'group') listStart = here
  }

  return null
}
