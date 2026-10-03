import { STANCE_INFO } from './stances'
import type { Stance } from './stances'

export type PolicyOptions = {
  /** Extra temp roots, such as the session's TMPDIR. */
  tempRoots: readonly string[]
}

type ToolCallLike = { tool: string } & Record<string, unknown>

const DEFAULT_TEMP_ROOTS = ['/tmp/', '/private/tmp/', '/var/tmp/', '/private/var/tmp/', '/var/folders/', '/private/var/folders/']

const WRITE_VERB = /(send|post|create|save|update|delete|merge|comment|reply|publish)/i

const EDIT_TOOLS: Record<string, string> = { Edit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' }

/** Resolves `.` and `..` segments of an absolute path. */
const normalize = (path: string): string => {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

/** True for an absolute path under the OS temp dir or a session scratchpad. */
export const isTempPath = (path: string, extraRoots: readonly string[]): boolean => {
  if (!path.startsWith('/')) return false
  const resolved = normalize(path)
  if (/\/scratchpad(\/|$)/.test(resolved)) return true
  const roots = [...DEFAULT_TEMP_ROOTS, ...extraRoots.map(root => (root.endsWith('/') ? root : `${root}/`))]
  return roots.some(root => `${resolved}/`.startsWith(root))
}

const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')', '{', '}', '`'])
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'])
const WRAPPERS = new Set(['command', 'builtin', 'env', 'sudo', 'doas', 'exec', 'time', 'nohup', 'nice', 'xargs', 'timeout', 'stdbuf', 'caffeinate'])
/** Wrapper options that take the next word as their value. */
const WRAPPER_VALUE_FLAGS: Record<string, ReadonlySet<string>> = {
  env: new Set(['-u', '-C', '-S']),
  sudo: new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-U']),
  nice: new Set(['-n']),
  xargs: new Set(['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a']),
  timeout: new Set(['-s', '-k', '--signal', '--kill-after']),
  stdbuf: new Set(['-i', '-o', '-e']),
}
const MAX_DEPTH = 4

/** Command substitutions (`$(...)`, backticks) inside a double-quoted string. */
const substitutions = (text: string): string[] =>
  [...text.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)].map(match => match[1] ?? match[2] ?? '')

/**
 * Splits a shell line into simple commands, each a list of words with quotes
 * removed. Splits outside quotes on `;`, `&`, `|`, newlines, parentheses,
 * braces, backticks and `$(`, so subshells, groups, background jobs and
 * command substitutions come out as commands of their own. Substitutions
 * inside double quotes are split out too.
 */
export const shellCommands = (line: string, depth = 0): string[][] => {
  const commands: string[][] = []
  let current: string[] = []
  let word = ''
  let isWord = false
  const endWord = () => {
    if (isWord) current.push(word)
    word = ''
    isWord = false
  }
  const endCommand = () => {
    endWord()
    if (current.length > 0) commands.push(current)
    current = []
  }
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    if (char === "'") {
      const close = line.indexOf("'", index + 1)
      const stop = close === -1 ? line.length : close
      word += line.slice(index + 1, stop)
      isWord = true
      index = stop
    } else if (char === '"') {
      let text = ''
      let at = index + 1
      while (at < line.length && line[at] !== '"') {
        if (line[at] === '\\' && at + 1 < line.length) at++
        text += line[at]
        at++
      }
      word += text
      isWord = true
      index = at
      if (depth < MAX_DEPTH) for (const inner of substitutions(text)) commands.push(...shellCommands(inner, depth + 1))
    } else if (char === '\\' && index + 1 < line.length) {
      word += line[index + 1]
      isWord = true
      index++
    } else if (char === ' ' || char === '\t') {
      endWord()
    } else if (char === '$' && line[index + 1] === '(') {
      endCommand()
      index++
    } else if (SEPARATORS.has(char)) {
      endCommand()
    } else {
      word += char
      isWord = true
    }
  }
  endCommand()
  return commands
}

const basename = (word: string): string => word.slice(word.lastIndexOf('/') + 1)

/**
 * The commands a word list runs, after dropping env assignments and wrappers
 * (`env`, `sudo`, `nice`, `xargs`, `timeout`, ...), taking the basename of the
 * command word (`/usr/bin/git` is `git`), and opening `sh -c '...'` and
 * `eval ...` into the commands they run.
 */
const unwrap = (list: string[], depth: number): string[][] => {
  const words = [...list]
  while (words.length > 0) {
    const first = words[0]!
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
      words.shift()
      continue
    }
    const name = basename(first)
    if (!WRAPPERS.has(name)) break
    words.shift()
    const valueFlags = WRAPPER_VALUE_FLAGS[name] ?? new Set<string>()
    while (words.length > 0 && (words[0]!.startsWith('-') || (name === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)))) {
      const option = words.shift()!
      if (valueFlags.has(option)) words.shift()
    }
    if (name === 'timeout' && words.length > 0) words.shift()
  }
  if (words.length === 0) return []
  const name = basename(words[0]!)
  const rest = words.slice(1)
  if (depth < MAX_DEPTH && name === 'eval') return commandsIn(rest.join(' '), depth + 1)
  if (depth < MAX_DEPTH && SHELLS.has(name)) {
    const flag = rest.findIndex(arg => /^-[A-Za-z]*c[A-Za-z]*$/.test(arg))
    if (flag !== -1 && rest[flag + 1] !== undefined) return commandsIn(rest[flag + 1]!, depth + 1)
  }
  return [[name, ...rest]]
}

/** Every simple command a shell line runs, unwrapped (see `unwrap`). */
export const commandsIn = (line: string, depth = 0): string[][] =>
  shellCommands(line, depth).flatMap(list => unwrap(list, depth))

/** The git subcommand and its args, skipping global options (`-C dir`, `-c k=v`). */
const gitArgs = (list: string[]): string[] | undefined => {
  if (list[0] !== 'git') return undefined
  let index = 1
  while (index < list.length && list[index]!.startsWith('-')) {
    const option = list[index]!
    index += option === '-C' || option === '-c' || option === '--git-dir' || option === '--work-tree' ? 2 : 1
  }
  return list.slice(index)
}

const BRANCH_WRITE_LONG = ['--delete', '--move', '--copy', '--force', '--set-upstream-to', '--unset-upstream', '--edit-description', '--track', '--no-track']
const BRANCH_LIST_VALUE_FLAGS = new Set(['--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--sort', '--format', '--color', '--abbrev'])

/** True for a short-option cluster (`-qb`, `-bname`) holding one of `letters`. */
const hasShortFlag = (arg: string, letters: string): boolean =>
  /^-[^-]/.test(arg) && [...letters].some(letter => arg.slice(1).includes(letter))

const isBranchWrite = (args: string[]): boolean => {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (BRANCH_WRITE_LONG.some(flag => arg === flag || arg.startsWith(`${flag}=`))) return true
    if (hasShortFlag(arg, 'dDmMcCfut')) return true
    if (BRANCH_LIST_VALUE_FLAGS.has(arg)) {
      index++
      continue
    }
    if (!arg.startsWith('-')) return true
  }
  return false
}

const isLongFlag = (arg: string, names: readonly string[]): boolean => names.some(name => arg === name || arg.startsWith(`${name}=`))

/** Names a git write the stance rules out, or undefined. */
const gitWrite = (stance: Stance, args: string[]): string | undefined => {
  const [sub, ...rest] = args
  if (sub === 'push') return 'git push'
  if (stance !== 'investigate') return undefined
  switch (sub) {
    case 'commit':
    case 'merge':
    case 'rebase':
    case 'cherry-pick':
    case 'revert':
    case 'am':
      return `git ${sub}`
    case 'branch':
      return isBranchWrite(rest) ? 'git branch (create/delete/rename)' : undefined
    case 'switch':
      return rest.some(arg => hasShortFlag(arg, 'cC') || isLongFlag(arg, ['--create', '--force-create', '--orphan'])) ? 'git switch -c' : undefined
    case 'checkout':
      return rest.some(arg => hasShortFlag(arg, 'bB') || isLongFlag(arg, ['--orphan'])) ? 'git checkout -b' : undefined
    case 'worktree':
      return rest[0] === 'add' ? 'git worktree add' : undefined
    default:
      return undefined
  }
}

/** gh verbs that change something on the host, whatever the noun. */
const GH_WRITE_VERBS = new Set([
  'create', 'merge', 'comment', 'review', 'edit', 'close', 'reopen', 'ready', 'delete', 'transfer', 'lock', 'unlock',
  'pin', 'unpin', 'upload', 'run', 'rerun', 'cancel', 'set', 'fork', 'rename', 'archive', 'unarchive', 'sync',
  'enable', 'disable', 'develop', 'add', 'remove', 'update-branch', 'revert',
])
/** gh nouns that only touch this machine. */
const GH_LOCAL_NOUNS = new Set(['config', 'alias', 'extension', 'ext', 'completion', 'auth', 'help'])
const GH_VALUE_FLAGS = new Set(['-R', '--repo', '-X', '--method', '-H', '--header', '-f', '-F', '--field', '--raw-field', '--input', '-q', '--jq', '-t', '--template', '-b', '--body', '-B', '--base'])

/** True when a `gh api` call sends a write: a non-GET method, or fields (which default to POST). */
const isApiWrite = (args: string[]): boolean => {
  let method: string | undefined
  let hasFields = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '-X' || arg === '--method') method = args[++index]
    else if (arg.startsWith('--method=')) method = arg.slice('--method='.length)
    else if (/^-X./.test(arg)) method = arg.slice(2)
    else if (['-f', '-F', '--field', '--raw-field', '--input'].includes(arg) || /^(-[fF].|--(raw-)?field=|--input=)/.test(arg)) hasFields = true
  }
  if (method !== undefined) return method.toUpperCase() !== 'GET'
  if (!hasFields) return false
  const isGraphql = args.find(arg => !arg.startsWith('-')) === 'graphql'
  return isGraphql ? args.some(arg => /\bmutation\b/.test(arg)) : true
}

/** Names a gh write the stance rules out, or undefined. */
const ghWrite = (stance: Stance, list: string[]): string | undefined => {
  if (list[0] !== 'gh') return undefined
  const args = list.slice(1)
  const positional: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (GH_VALUE_FLAGS.has(arg)) index++
    else if (!arg.startsWith('-')) positional.push(arg)
  }
  const [noun, verb] = positional
  if (noun === undefined) return undefined
  if (noun === 'api') return isApiWrite(args.slice(args.indexOf('api') + 1)) ? 'gh api (write method)' : undefined
  if (GH_LOCAL_NOUNS.has(noun)) return undefined
  if (stance === 'investigate' && noun === 'pr' && verb === 'checkout') return 'gh pr checkout'
  return verb !== undefined && GH_WRITE_VERBS.has(verb) ? `gh ${noun} ${verb}` : undefined
}

const denyText = (stance: Stance, what: string): string => {
  const info = STANCE_INFO[stance]
  const loosen = stance === 'investigate' ? '/stance draft or /stance build' : '/stance build'
  return `STANCE ${info.title}: ${what} is off in ${info.title} stance (${info.summary}). Report instead, or ask the person to switch with ${loosen}.`
}

/**
 * The deny text when `stance` rules out this tool call, or undefined when it
 * may run. Build and ship rule out nothing.
 */
export const checkToolCall = (stance: Stance, call: { tool: string }, options: PolicyOptions): string | undefined => {
  if (stance === 'build' || stance === 'ship') return undefined
  const input = call as ToolCallLike

  if (input.tool.startsWith('mcp__')) {
    const name = input.tool.split('__').at(-1) ?? ''
    return WRITE_VERB.test(name) ? denyText(stance, `the MCP write tool ${input.tool}`) : undefined
  }

  const pathKey = EDIT_TOOLS[input.tool]
  if (pathKey !== undefined) {
    if (stance !== 'investigate') return undefined
    const path = typeof input[pathKey] === 'string' ? (input[pathKey] as string) : ''
    return isTempPath(path, options.tempRoots) ? undefined : denyText(stance, `${input.tool} of ${path || 'a file'} (only temp and scratchpad files may be written)`)
  }

  if (input.tool === 'Bash' && typeof input.command === 'string') {
    for (const list of commandsIn(input.command)) {
      const git = gitArgs(list)
      const hit = (git && gitWrite(stance, git)) || ghWrite(stance, list)
      if (hit) return denyText(stance, hit)
    }
  }
  return undefined
}
