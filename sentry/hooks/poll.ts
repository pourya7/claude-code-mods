// The Bash shapes that hand-roll waiting on CI, which sentry does instead.

// Where a new command starts: the start of the line, after a separator or
// pipe (; & | ( { ` or a newline), or after a shell keyword that opens a body.
const COMMAND_START = String.raw`(?:^|[;&|({\x60\n]|\b(?:do|then|else)\b)\s*`

const SLEEP = new RegExp(`${COMMAND_START}sleep\\s+(\\d+(?:\\.\\d+)?)([smhd]?)\\b`, 'g')
const CHECKS_WATCH = /\bgh\s+pr\s+checks\b[^;&|]*\s--watch\b/
const RUN_WATCH = /\bgh\s+run\s+watch\b/
const LOOP = new RegExp(`${COMMAND_START}(?:until|while)\\b([\\s\\S]*?)\\bdone\\b`, 'g')
const GH_COMMAND = new RegExp(`${COMMAND_START}gh\\s`)
const QUOTED = /\$'(?:[^'\\]|\\[\s\S])*'|'[^']*'|"(?:[^"\\]|\\[\s\S])*"/g

const UNIT_SECONDS: Record<string, number> = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }

/** The command with every quoted string emptied, so words in messages and titles never match. */
export function withoutQuotes(command: string): string {
  return command.replace(QUOTED, "''")
}

/** Names the sleep-poll shape a command has, or null when it has none. */
export function sleepPollShape(command: string): string | null {
  const text = withoutQuotes(command)
  for (const match of text.matchAll(SLEEP)) {
    const seconds = Number(match[1]) * (UNIT_SECONDS[match[2] ?? ''] ?? 1)
    if (seconds >= 20) return `sleep ${match[1]}${match[2] ?? ''}`
  }
  if (CHECKS_WATCH.test(text)) return 'gh pr checks --watch'
  if (RUN_WATCH.test(text)) return 'gh run watch'
  for (const match of text.matchAll(LOOP)) {
    if (GH_COMMAND.test(match[1] ?? '')) return 'a loop that polls gh'
  }
  return null
}

export function denyText(numbers: readonly number[]): string {
  return `sentry is watching PR ${numbers.map(number => `#${number}`).join(', ')} and will wake you; end your turn instead.`
}
