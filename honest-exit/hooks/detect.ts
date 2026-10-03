// The three quiet shell failures honest-exit catches, as pure functions of a
// Bash command and what it printed.

import type { HonestExitKind } from '../types'
import { hasPipefail, isCheckCommand, isReader, maskQuoted, pipesInto, producersBefore, simpleCommands } from './shell'

export type Finding = {
  kind: HonestExitKind
  /** What gave it away: the glob, the missing name, or the failure word. */
  clue: string
  /** The model-visible note. */
  note: string
  /** The toast the user sees. */
  toast: string
}

export type Outcome = {
  isError: boolean
  /** Everything the model read: stdout and stderr together. */
  output: string
  /** The stderr part alone, when the call succeeded and the tool kept it apart. */
  stderr?: string
}

// ── glob matched nothing ─────────────────────────────────────────────────

const ZSH_NO_MATCH = /^(?:[\w./()-]+:\s*)?(?:\d+:\s*)?no matches found: (.+)$/m
const BASH_NO_MATCH = /^(?:[\w./-]+:\s*)?(?:line \d+:\s*)?no match: (.+)$/m
const CSH_NO_MATCH = /^No match\.?$/m

/** The glob the shell refused to expand, `(a glob)` when it did not say which. */
export const noMatchClue = (output: string): string | undefined => {
  const zsh = ZSH_NO_MATCH.exec(output)?.[1] ?? BASH_NO_MATCH.exec(output)?.[1]
  if (zsh !== undefined) return zsh.trim()
  return CSH_NO_MATCH.test(output) ? '(a glob)' : undefined
}

// ── command not found ────────────────────────────────────────────────────

/** Names people commonly alias or wrap in their interactive shell. */
export const ALIAS_PRONE = ['cp', 'rm', 'mv', 'grep', 'ls', 'll', 'la', 'l', 'cat', 'python', 'pip'] as const

const NOT_FOUND = [
  /^(?:[\w./()-]+:\s*)?(?:\d+:\s*)?command not found: (\S+)\s*$/m, // zsh
  /^(?:[\w./-]+:\s*)(?:line \d+:\s*)?(\S+): command not found\s*$/m, // bash
  /^(?:[\w./-]+:\s*)(?:\d+:\s*)(\S+): not found\s*$/m, // dash / sh
]

/** The name a shell said it could not find, if the output has a shell's own error line. */
export const notFoundName = (output: string): string | undefined => {
  for (const pattern of NOT_FOUND) {
    const name = pattern.exec(output)?.[1]
    if (name !== undefined) return name
  }
  return undefined
}

// ── exit status hidden by a pipe or || true ─────────────────────────────

export const FILTERS = ['head', 'tail', 'tee', 'grep', 'egrep', 'fgrep'] as const

// `strong` signatures come only from a crashed program or a test runner's
// summary; the others are ordinary words in logs, commit messages and code.
const SIGNATURES: { pattern: RegExp; clue: (hit: RegExpExecArray) => string; isStrong: boolean }[] = [
  { pattern: /\bFAILED\b/, clue: () => 'FAILED', isStrong: true },
  { pattern: /\b([1-9]\d*) failing\b/, clue: hit => `${hit[1]} failing`, isStrong: true },
  { pattern: /(?<!\b0 )\bfailed\b/, clue: () => 'failed', isStrong: false },
  { pattern: /Error:/, clue: () => 'Error:', isStrong: false },
  { pattern: /✗/, clue: () => '✗', isStrong: false },
  { pattern: /^Traceback \(most recent call last\)/m, clue: () => 'Traceback', isStrong: true },
]

export const pipesIntoFilter = (command: string): boolean => pipesInto(command, FILTERS)

/** Ends in `|| true` or `|| :`, so any failure before it exits 0. */
export const swallowsStatus = (command: string): boolean =>
  /\|\|\s*(?:true|:)\s*;?\s*$/.test(maskQuoted(command))

/**
 * The first failure signature in `output`, if it ran behind a status-hiding pipe or `|| true` and exited 0.
 *
 * A test, lint or build command before the pipe counts every signature. Any
 * other program counts only the strong ones, and only when the command does
 * not spell the word out itself (a search term). Commands that just print
 * existing text (cat, grep, git log...) count nothing: their failure words are data.
 */
export const hiddenExitClue = (command: string, output: string, isError: boolean): string | undefined => {
  if (isError) return undefined
  const isSwallowed = swallowsStatus(command)
  // With pipefail, a pipe alone no longer hides a failure; || true still does.
  const isPiped = pipesIntoFilter(command) && !hasPipefail(command)
  if (!isSwallowed && !isPiped) return undefined
  const producers = [
    ...(isPiped ? producersBefore(command, FILTERS) : []),
    ...(isSwallowed ? simpleCommands(command).filter(part => !/^(?:true|:)\s*;?$/.test(part)) : []),
  ]
  const isCheck = producers.some(isCheckCommand)
  if (!isCheck && producers.every(isReader)) return undefined
  let first: { at: number; clue: string } | undefined
  for (const signature of SIGNATURES) {
    if (!isCheck && !signature.isStrong) continue
    const hit = signature.pattern.exec(output)
    if (hit === null) continue
    if (!isCheck && command.includes(hit[0])) continue
    if (first === undefined || hit.index < first.at) first = { at: hit.index, clue: signature.clue(hit) }
  }
  return first?.clue
}

// ── notes ────────────────────────────────────────────────────────────────

const noMatchNote = (glob: string) =>
  `honest-exit: the shell reported "no matches found" for ${glob}: the glob didn't match, so the command that contained it never ran. ` +
  'Other commands on the same line (joined by `;`, `||` or newlines) may still have run: read their output before re-running anything. ' +
  'Check the path, or quote the pattern ' +
  `('${glob === '(a glob)' ? '*.x' : glob}') if a tool such as grep or find should expand it instead of the shell.`

const notFoundNote = (name: string) =>
  `honest-exit: "${name}" was not found in this shell. It is often an alias or function in the user's interactive shell, ` +
  'and agent shells may differ: they do not load interactive aliases, functions or every PATH entry. ' +
  `The command that used "${name}" did not run, but other commands on the same line (joined by \`;\`, \`||\` or newlines) may have: read their output before re-running anything. ` +
  `Use the real binary (for example \`command -v ${name}\` to locate it) instead of assuming the alias exists.`

const hiddenExitNote = (clue: string, command: string) => {
  const how = swallowsStatus(command) ? 'ends in `|| true`' : 'pipes into a filter (head, tail, tee or grep)'
  return (
    `honest-exit: the command exited 0, but its output contains "${clue}". It ${how}, so the pipeline hid the exit status of the first command. ` +
    'Treat this run as failed until proven otherwise: re-run it without the pipe, or with `set -o pipefail;` in front and piped into `tail` (with `head`, the early exit can turn a pass into status 141), and read the real exit status.'
  )
}

/** Every quiet failure in one Bash result, in a fixed order. */
export const detect = (command: string, outcome: Outcome): Finding[] => {
  const findings: Finding[] = []
  // The shell's own error lines. A failed call: everything it printed. A call
  // that succeeded: only stderr, so file contents and search hits on stdout
  // (a log, this README) are never read as the shell talking.
  const shellText = outcome.isError ? outcome.output : (outcome.stderr ?? '')
  const glob = noMatchClue(shellText)
  if (glob !== undefined) {
    findings.push({ kind: 'no-match', clue: glob, note: noMatchNote(glob), toast: `HONEST EXIT ▸ GLOB MATCHED NOTHING: ${glob}` })
  }
  const name = notFoundName(shellText)
  if (name !== undefined && (ALIAS_PRONE as readonly string[]).includes(name)) {
    findings.push({ kind: 'not-found', clue: name, note: notFoundNote(name), toast: `HONEST EXIT ▸ NOT IN THIS SHELL: ${name}` })
  }
  const clue = hiddenExitClue(command, outcome.output, outcome.isError)
  if (clue !== undefined) {
    findings.push({ kind: 'hidden-exit', clue, note: hiddenExitNote(clue, command), toast: `HONEST EXIT ▸ PIPE HID A FAILURE: ${clue}` })
  }
  return findings
}

// ── labels ───────────────────────────────────────────────────────────────

export const KIND_LABEL: Record<HonestExitKind, string> = {
  'no-match': 'GLOB',
  'not-found': 'NOT FOUND',
  'hidden-exit': 'PIPE',
}

export const statusText = (caught: number): string | undefined => (caught > 0 ? `EXIT ▸ ${caught} CAUGHT` : undefined)

/** Cuts a command to one short line for the log. */
export const shortCommand = (command: string, width = 60): string => {
  const line = command.replace(/\s+/g, ' ').trim()
  return line.length > width ? `${line.slice(0, width - 1)}…` : line
}

/**
 * What a Bash call printed and whether the tool reported an error, read from
 * the `tool.call` result. Undefined when there is nothing honest to read: a
 * deny, an interrupted run, or a command still running in the background.
 */
export const outcomeOf = (ran: {
  deny?: string
  isError?: true
  result?: unknown
  text?: string
}): Outcome | undefined => {
  if (ran.deny !== undefined) return undefined
  if (ran.isError === true) {
    const output = ran.text ?? (typeof ran.result === 'string' ? ran.result : '')
    return { isError: true, output }
  }
  const result = (typeof ran.result === 'object' && ran.result !== null ? ran.result : {}) as Record<string, unknown>
  if (result.interrupted === true || typeof result.backgroundTaskId === 'string') return undefined
  const streams = [result.stdout, result.stderr].filter((part): part is string => typeof part === 'string' && part !== '')
  const output = streams.length > 0 ? streams.join('\n') : (ran.text ?? '')
  return { isError: false, output, stderr: typeof result.stderr === 'string' ? result.stderr : '' }
}
