import type { AntiCheatCheck } from '../types'

/**
 * Which kind of evidence a Bash command is, by the tool it runs. A compound
 * command (`npm run lint && npm test`) can be several kinds at once.
 */
const CHECK_PATTERNS: readonly [AntiCheatCheck, RegExp][] = [
  [
    'test',
    /\b(pytest|jest|vitest|mocha|go test|cargo test|(npm|pnpm|yarn|bun)( run)? test|just test|make test|rspec|phpunit)\b/,
  ],
  ['lint', /\b(eslint|ruff|tsc|mypy|pyright|lint|typecheck|type-check)\b/],
  [
    'build',
    /\b((npm|pnpm|yarn|bun)( run)? build|cargo build|go build|make build|gradle( \S+)* build|mvn( \S+)* (package|install)|docker build|vite build|next build)\b/,
  ],
  ['ci', /\b(gh pr checks|gh run (view|watch))\b|check-runs|statusCheckRollup/],
  ['push', /\bgit( -C \S+)? push\b/],
]

/**
 * CI commands whose exit status is the CI result: `gh pr checks`, and
 * `gh run view/watch` with `--exit-status`. Every other CI query (a plain
 * `gh run view`, a check-runs or statusCheckRollup read) exits 0 whatever
 * the runs concluded, so it only reads the status.
 */
const CI_RESULT = /\bgh pr checks\b|\bgh run (view|watch)\b.*--exit-status\b/

/** Text a command merely mentions (quoted strings, comments) is not what it runs. */
const stripQuoted = (command: string) =>
  command.replace(/'[^']*'|"[^"]*"/g, '""').replace(/(^|\s)#.*$/gm, '$1')

/** Commands that only search or print text that names a tool. */
const READS_ONLY = /^\s*(grep|rg|ag|echo|printf|cat|less|head|tail|which|type|man)\b/

/** Commands that install or add a tool rather than run it (`npm install -D jest`). */
const INSTALLS =
  /^\s*(sudo\s+)?((npm|pnpm|yarn|bun)\s+(install|i|add|ci|remove|rm|uninstall|update|upgrade)\b|(pip3?|pipx|uv\s+pip|uv\s+tool|python3?\s+-m\s+pip)\s+install\b|uv\s+(add|remove|sync)\b|poetry\s+(add|install|remove)\b|cargo\s+(install|add)\b|go\s+(install|get)\b|(brew|gem|apt|apt-get|dnf|yum|apk)\s+(install|add)\b)/

/** The command separators bash runs one after another, longest first. */
const SEPARATOR = /(\|\||&&|\|&|\||;|\n)/

/** `set -o pipefail` (or `set -euo pipefail`) makes a pipeline fail when any part fails. */
const PIPEFAIL = /\bpipefail\b/
/** `set -e` stops a list at the first failing command, so `;` hides nothing. */
const ERREXIT = /\bset\s+-\w*e/

/** How one check kind in a command reports its result. */
export type CheckStatus =
  /** The command's exit status is this check's result. */
  | 'exit'
  /** A pipe, `||` or a later `;` command decides the exit status instead. */
  | 'masked'
  /** The check only reads a status that its exit code does not reflect. */
  | 'read'

export type CommandAnalysis = { checks: AntiCheatCheck[]; status: Partial<Record<AntiCheatCheck, CheckStatus>> }

/** Rank when one kind appears in several segments: any masked one taints the run. */
const RANK: Record<CheckStatus, number> = { read: 0, exit: 1, masked: 2 }

/**
 * The check kinds a command runs and, for each, whether its exit status is
 * the result. Bash reports the status of the last command in a pipeline or
 * list, so `pytest | tail`, `npm test || true` and `pytest; echo done` all
 * exit 0 when the tests fail.
 */
export const analyzeCommand = (command: string): CommandAnalysis => {
  const text = stripQuoted(command)
  const parts = text.split(SEPARATOR)
  const hasPipefail = PIPEFAIL.test(text)
  const hasErrexit = ERREXIT.test(text)
  const status: Partial<Record<AntiCheatCheck, CheckStatus>> = {}

  // parts alternates segment, separator, segment, ...
  for (let index = 0; index < parts.length; index += 2) {
    const segment = parts[index] ?? ''
    if (READS_ONLY.test(segment) || INSTALLS.test(segment)) continue

    const kinds = CHECK_PATTERNS.filter(([, pattern]) => pattern.test(segment)).map(([check]) => check)
    if (kinds.length === 0) continue

    // Pipes bind tighter than && and ||, which bind tighter than ; and newlines.
    // A failing check is hidden by a pipe straight after it (without pipefail),
    // or by a later || or ; whose command then runs and sets the status. A
    // later `&& next | more` is skipped when the check fails, so it hides nothing.
    let isMasked = false
    for (let after = index + 1; after < parts.length; after += 2) {
      const separator = parts[after]
      const rest = parts[after + 1] ?? ''
      if (rest.trim() === '') continue
      const isPipe = separator === '|' || separator === '|&'
      if (isPipe && after === index + 1 && !hasPipefail) {
        isMasked = true
        break
      }
      if (isPipe || separator === '&&') continue
      if ((separator === ';' || separator === '\n') && hasErrexit) continue
      isMasked = true
      break
    }

    for (const kind of kinds) {
      const own: CheckStatus = kind === 'ci' && !CI_RESULT.test(segment) ? 'read' : isMasked ? 'masked' : 'exit'
      const seen = status[kind]
      status[kind] = seen === undefined || RANK[own] > RANK[seen] ? own : seen
    }
  }

  const checks = CHECK_PATTERNS.map(([check]) => check).filter(check => status[check] !== undefined)
  return { checks, status }
}

export const classifyCommand = (command: string): AntiCheatCheck[] => analyzeCommand(command).checks
