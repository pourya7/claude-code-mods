// Tiny, conservative shell reading: enough to tell quoted text from the
// shell's own syntax. It is not a parser; when unsure, it says "quoted".

/**
 * The command with every quoted character (and the quotes) replaced by `_`,
 * same length, so positions line up with the original. Backslash escapes
 * outside quotes are blanked too.
 */
export const maskQuoted = (command: string): string => {
  let out = ''
  let quote: '"' | "'" | undefined
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? ''
    if (quote === undefined) {
      if (char === '\\') {
        out += '__'
        index += 1
      } else if (char === "'" || char === '"') {
        quote = char
        out += '_'
      } else {
        out += char
      }
    } else if (quote === '"' && char === '\\') {
      out += '__'
      index += 1
    } else {
      if (char === quote) quote = undefined
      out += '_'
    }
  }
  return out.slice(0, command.length)
}

const pipePattern = (names: readonly string[]) =>
  new RegExp(`(?<!\\|)\\|&?\\s*(?:${names.join('|')})(?=\\s|$|;|\\))`, 'g')

/** Unquoted pipe (`|` or `|&`, never `||`) into one of `names`. */
export const pipesInto = (command: string, names: readonly string[]): boolean =>
  pipePattern(names).test(maskQuoted(command))

const SEPARATOR = /;|&&|\|\||\||\(|\n/g

/** The simple command right before each unquoted pipe into one of `names`. */
export const producersBefore = (command: string, names: readonly string[]): string[] => {
  const bare = maskQuoted(command)
  const producers: string[] = []
  for (const hit of bare.matchAll(pipePattern(names))) {
    const pipeAt = hit.index ?? 0
    let from = 0
    for (const separator of bare.slice(0, pipeAt).matchAll(SEPARATOR)) {
      from = (separator.index ?? 0) + separator[0].length
    }
    producers.push(command.slice(from, pipeAt).trim())
  }
  return producers
}

/** Already runs with pipefail (`set -o pipefail`, `set -euo pipefail`, zsh `setopt pipefail`). */
export const hasPipefail = (command: string): boolean =>
  /\bset\s+-[a-z]*o\s+pipefail\b|\bsetopt\s+pipe_?fail\b/i.test(command)

/** Every simple command in `command`, split on unquoted `;`, `&&`, `||`, `|`, `(` and newlines. */
export const simpleCommands = (command: string): string[] => {
  const bare = maskQuoted(command)
  const parts: string[] = []
  let from = 0
  for (const separator of bare.matchAll(SEPARATOR)) {
    parts.push(command.slice(from, separator.index ?? 0).trim())
    from = (separator.index ?? 0) + separator[0].length
  }
  parts.push(command.slice(from).trim())
  return parts.filter(part => part !== '' && part !== ')')
}

// Leading `VAR=x`, and launchers that run the real command after them.
const LEAD = /^(?:[A-Za-z_]\w*=\S*\s+)*(?:(?:time|env|npx|bunx|uv run|poetry run|pipenv run|bundle exec|(?:pnpm|yarn) exec|python3? -m)\s+)*/

/** The simple command with its quoted text masked and env/launcher prefixes stripped. */
const commandWords = (simple: string): string => maskQuoted(simple.trim()).replace(LEAD, '')

const CHECK_COMMAND =
  /^(?:pytest|jest|vitest|mocha|tsc|eslint|ruff|mypy|pyright|rspec|phpunit|go (?:test|build|vet)|cargo (?:test|build|check|clippy)|(?:npm|pnpm|yarn|bun)(?: run)? (?:test|lint|build|typecheck|check)|node --test|make|gradle|\.\/gradlew|mvn|dotnet (?:test|build))(?=[\s:]|$)/

/** A test, lint or build command, judged by its first word(s), not by a word anywhere in it. */
export const isCheckCommand = (simple: string): boolean => CHECK_COMMAND.test(commandWords(simple))

const READERS = new Set([
  'cat', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'git', 'gh', 'sed', 'awk', 'jq', 'yq', 'find', 'ls', 'echo', 'printf',
  'less', 'more', 'head', 'tail', 'sort', 'uniq', 'wc', 'diff', 'cut', 'tr', 'nl', 'zcat', 'journalctl',
])

/** A command that only prints existing text (files, history, search hits), so failure words in it are data. */
export const isReader = (simple: string): boolean => READERS.has(commandWords(simple).split(/\s+/)[0] ?? '')
