// Words for a proof: labels, the status line, the /prove reply, the gate's
// deny text, and which Bash commands the gate stops.

import type { ProvePhase, ProveProof, ProveRun, ProveVerdict } from '../types'

const LABELS: Record<ProveVerdict, string> = {
  proven: 'PROVEN ★',
  'not-proven': 'NOT PROVEN',
  broken: 'BROKEN',
  'no-tests': 'NO TESTS CHANGED',
  'no-source': 'TESTS PASS',
  nothing: 'NOTHING TO PROVE',
  error: 'ERROR',
  'restore-failed': 'RESTORE FAILED',
}

const MEANINGS: Record<ProveVerdict, string> = {
  proven: 'The changed tests fail without the fix and pass with it.',
  'not-proven': 'The changed tests pass without the fix, so they do not test it. Write a test that fails on the old code.',
  broken: 'The changed tests fail with the fix.',
  'no-tests': 'Source changed but no test file did. Add a test that fails without the fix.',
  'no-source': 'Only tests changed and they pass; there is no fix to revert.',
  nothing: 'Nothing changed against the base.',
  error: 'The proof could not run; your files were restored.',
  'restore-failed': 'A restored file did not match its copy. Stop and put it back by hand.',
}

export const verdictLabel = (verdict: ProveVerdict): string => LABELS[verdict]

/** The verdicts the gate lets through: proven, and the ones with nothing to revert. */
export const gateAllows = (verdict: ProveVerdict): boolean =>
  verdict === 'proven' || verdict === 'no-source' || verdict === 'nothing'

/** Words before a command that still run it: `command git push`, `env A=1 git push`, `sudo git push`. */
const WRAPPERS = new Set(['command', 'builtin', 'exec', 'nohup', 'time', 'env', 'sudo', 'nice', 'doas'])
/** A wrapper's options that take the next word as their value. */
const WRAPPER_ARGS = new Set(['-u', '-g', '-n', '-C', '--user', '--group', '--chdir', '--unset'])
/** git's global options that take the next word as their value. */
const GIT_ARGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path'])
/** gh's options that take the next word as their value. */
const GH_ARGS = new Set(['-R', '--repo'])
/** Shells whose `-c` text is a command line of its own. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])

const baseName = (word: string): string => word.slice(word.lastIndexOf('/') + 1)

/** Skips options (and the values of those in `withValue`) from `i`; the index of the first other word. */
const skipOptions = (words: readonly string[], i: number, withValue: ReadonlySet<string>): number => {
  let at = i
  while (at < words.length && (words[at] ?? '').startsWith('-')) {
    at += withValue.has(words[at] ?? '') ? 2 : 1
  }
  return at
}

/** What one simple command runs, if it is a push or a PR create. */
const gatedWords = (words: readonly string[]): string | null => {
  let i = 0
  for (;;) {
    while (i < words.length && /^[A-Za-z_]\w*=/.test(words[i] ?? '')) i += 1
    if (!WRAPPERS.has(baseName(words[i] ?? ''))) break
    i = skipOptions(words, i + 1, WRAPPER_ARGS)
  }
  const program = baseName(words[i] ?? '')
  if (program === 'git') return words[skipOptions(words, i + 1, GIT_ARGS)] === 'push' ? 'git push' : null
  if (program === 'gh') {
    const pr = skipOptions(words, i + 1, GH_ARGS)
    if (words[pr] !== 'pr') return null
    const verb = words[skipOptions(words, pr + 1, GH_ARGS)]
    return verb === 'create' || verb === 'new' ? 'gh pr create' : null
  }
  return null
}

/** The text of `sh -c '...'` / `bash -c "..."` and `eval '...'`, which run as command lines of their own. */
const nestedScripts = (command: string): string[] => {
  const nested: string[] = []
  const pattern = /(?:^|[\s;&|(`])(?:(?:\S*\/)?(\w+)\s+(?:-\w+\s+)*-\w*c\w*|eval)\s+("((?:[^"\\]|\\.)*)"|'([^']*)')/g
  for (const match of command.matchAll(pattern)) {
    if (match[1] !== undefined && !SHELLS.has(match[1])) continue
    nested.push((match[3] ?? match[4] ?? '').replace(/\\(.)/g, '$1'))
  }
  return nested
}

/**
 * `git push` or `gh pr create` (or its alias `gh pr new`) when the command
 * runs one, else null. Catches the usual spellings: wrappers such as
 * `command`, `env`, `sudo`, `time`; a path on the program; git's global
 * options with or without `=`; `gh -R o/r`; line continuations; `sh -c`,
 * `eval`, `$(...)` and backticks. Other quoted text is ignored. It is a guard
 * rail, not a security boundary.
 */
export const gatedCommand = (command: string, depth = 0): string | null => {
  const joined = command.replace(/\\\r?\n/g, ' ')
  if (depth < 3) {
    for (const script of nestedScripts(joined)) {
      const found = gatedCommand(script, depth + 1)
      if (found !== null) return found
    }
  }
  const unquoted = joined.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""')
  for (const part of unquoted.split(/[;&|()`\n]+|\$\(/)) {
    const found = gatedWords(part.trim().split(/\s+/).filter(word => word !== '' && word !== '!' && word !== '{'))
    if (found !== null) return found
  }

  return null
}

/** The status line: the verdict, or the run's progress, or the gate; under 40 columns. */
export const statusLine = (proof: ProveProof | null, phase: ProvePhase, isGateOn: boolean): string | undefined => {
  if (phase === 'without') return 'PROVE-IT ▸ PROVING 1/2'
  if (phase === 'with') return 'PROVE-IT ▸ PROVING 2/2'
  const gate = isGateOn ? ' · GATE' : ''
  if (proof === null) return isGateOn ? 'PROVE-IT ▸ GATE ARMED' : undefined
  if (proof.verdict === 'proven') return `PROVE-IT ★ PROVEN${gate}`

  return `PROVE-IT ▸ ${LABELS[proof.verdict]}${gate}`
}

const runLine = (name: string, run: ProveRun | null): string[] => {
  if (run === null) return []
  const result = run.exitCode === 0 ? 'PASS' : `FAIL (exit ${run.exitCode})`
  const tail = run.tail === '' ? [] : run.tail.split('\n').map(line => `    ${line}`)
  return [`  ${name}: ${result}`, ...tail]
}

const listLine = (name: string, paths: readonly string[]): string[] =>
  paths.length === 0 ? [] : [`  ${name}: ${paths.slice(0, 8).join(', ')}${paths.length > 8 ? ` +${paths.length - 8} more` : ''}`]

/** The /prove reply: verdict, meaning, files, both runs, base. */
export const replyText = (proof: ProveProof): string =>
  [
    `PROVE-IT ▸ ${LABELS[proof.verdict]}`,
    MEANINGS[proof.verdict],
    ...(proof.detail === '' ? [] : [proof.detail]),
    ...listLine('fix', proof.sources),
    ...listLine('tests', proof.tests),
    ...runLine('without the fix', proof.without),
    ...runLine('with the fix', proof.with),
    ...(proof.base === '' ? [] : [`  base: ${proof.base}`]),
  ].join('\n')

/** What the model reads when the gate refuses a push or PR. */
export const denyText = (proof: ProveProof, command: string): string =>
  [
    `prove-it refused ${command}: ${LABELS[proof.verdict]}.`,
    replyText(proof),
    'Fix this and try again. If the user decides to go ahead anyway, they can run /prove skip to let the next push or PR through.',
  ].join('\n')
