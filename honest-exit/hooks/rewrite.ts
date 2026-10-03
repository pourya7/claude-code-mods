// Optional, idempotent rewrites (userConfig.rewrite, off by default).

import { hasPipefail, isCheckCommand, maskQuoted, producersBefore } from './shell'

// `--flag=value` where the value has a glob character and no quote, `$` or backtick.
const FLAG_GLOB = /(^|\s)(--?[A-Za-z][\w-]*=)([^\s'"$`;|&()<>]*[*?[][^\s'"$`;|&()<>]*)(?=\s|$|;|\||&|\))/g

/** Quotes unquoted glob values in `--include=*.x`-style flags, so the shell leaves them to the tool. */
export const quoteFlagGlobs = (command: string): string => {
  const bare = maskQuoted(command)
  let out = ''
  let last = 0
  for (const hit of bare.matchAll(FLAG_GLOB)) {
    const lead = hit[1] ?? ''
    const flag = hit[2] ?? ''
    const start = (hit.index ?? 0) + lead.length + flag.length
    const value = command.slice(start, start + (hit[3] ?? '').length)
    // The mask must agree with the original: no hidden quotes inside.
    if (value !== hit[3]) continue
    // A brace list (`*.{ts,tsx}`) is the shell's to expand: grep's --include and
    // most tools' globs don't know braces, so quoting it would match nothing.
    if (value.includes('{')) continue
    out += `${command.slice(last, start)}'${value}'`
    last = start + value.length
  }
  return out + command.slice(last)
}

/**
 * Prefixes `set -o pipefail;` when a test, lint or build command is piped into tail.
 * Not head: head exits early, the producer dies of SIGPIPE, and pipefail turns a pass into status 141.
 */
export const addPipefail = (command: string): string => {
  if (hasPipefail(command)) return command
  const producers = producersBefore(command, ['tail'])
  return producers.some(isCheckCommand) ? `set -o pipefail; ${command}` : command
}

export type Rewrite = { command: string; changes: string[] }

/** Both rewrites, with a line per change for the model. Running it on its own output changes nothing. */
export const rewriteCommand = (command: string): Rewrite => {
  const changes: string[] = []
  let next = quoteFlagGlobs(command)
  if (next !== command) changes.push('quoted the glob in a --flag=pattern argument so the shell does not expand it')
  const piped = addPipefail(next)
  if (piped !== next) changes.push('added `set -o pipefail;` so a failing check is not hidden by tail')
  next = piped
  return { command: next, changes }
}

export const rewriteNote = (before: string, rewrite: Rewrite): string =>
  `honest-exit rewrote this Bash command before it ran (${rewrite.changes.join('; ')}).\n` +
  `You wrote: ${before}\nIt ran:    ${rewrite.command}`
