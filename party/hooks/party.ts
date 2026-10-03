// party: pure logic. Heartbeats, staleness, PR targets, locks, wait bars and text.
import type { PartyMember, PartyState, PartyTouch, PartyWait } from '../types'

export const PLUGIN = 'party'
export const HEARTBEAT_MS = 15_000
export const STALE_MS = 2 * 60_000
export const KEY_PREFIX = 'session:'

const STATES: readonly PartyState[] = ['working', 'waiting-on-you', 'idle', 'done']
const STATE_ORDER: Record<PartyState, number> = { 'waiting-on-you': 0, working: 1, idle: 2, done: 3 }
/** The gh pr verbs that act on a PR, each with its flags that take no value (so the word after them may be the selector). */
const BOOLEAN_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  merge: new Set(['--squash', '-s', '--merge', '-m', '--rebase', '-r', '--auto', '--admin', '--disable-auto', '-d', '--delete-branch']),
  close: new Set(['-d', '--delete-branch']),
  comment: new Set(['--editor', '-e', '--web', '-w', '--edit-last', '--delete-last', '--create-if-none', '--yes']),
  review: new Set(['--approve', '-a', '--request-changes', '-r', '--comment', '-c']),
  edit: new Set(['--remove-milestone']),
}
const PR_URL = /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/

export type PrTarget = { repo: string; pr: number }

export const memberKey = (sessionId: string) => `${KEY_PREFIX}${sessionId}`

export function isMember(value: unknown): value is PartyMember {
  if (typeof value !== 'object' || value === null) return false
  const one = value as Record<string, unknown>
  return (
    typeof one.sessionId === 'string' &&
    typeof one.title === 'string' &&
    typeof one.cwd === 'string' &&
    typeof one.branch === 'string' &&
    (one.repo === null || typeof one.repo === 'string') &&
    STATES.includes(one.state as PartyState) &&
    typeof one.since === 'number' &&
    typeof one.beatAt === 'number' &&
    typeof one.lastTool === 'string' &&
    Array.isArray(one.touches)
  )
}

export const isLive = (one: PartyMember, now: number) => now - one.beatAt <= STALE_MS

/** Live sessions only: waiting first (longest wait first), then working, idle, done. */
export function liveMembers(values: readonly unknown[], now: number): PartyMember[] {
  return values
    .filter(isMember)
    .filter(one => isLive(one, now))
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.since - b.since || a.sessionId.localeCompare(b.sessionId))
}

/** Session keys whose entry is stale or unreadable; other keys are never touched. */
export function staleKeys(entries: Readonly<Record<string, unknown>>, now: number): string[] {
  return Object.entries(entries)
    .filter(([key, value]) => key.startsWith(KEY_PREFIX) && !(isMember(value) && isLive(value, now)))
    .map(([key]) => key)
}

/** The member in `state`: the clock restarts only when the state changes. */
export function withState(one: PartyMember, state: PartyState, now: number, waitingFor: PartyWait | null = null): PartyMember {
  const isSame = one.state === state && (state !== 'waiting-on-you' || one.waitingFor === waitingFor)
  return {
    ...one,
    state,
    since: isSame ? one.since : now,
    waitingFor: state === 'waiting-on-you' ? waitingFor : null,
  }
}

/** The tools whose call waits on the person until they answer. */
export function waitKind(tool: string): PartyWait | null {
  if (tool === 'AskUserQuestion') return 'question'
  if (tool === 'ExitPlanMode') return 'plan'
  return null
}

const SEPARATORS = new Set(['&&', '||', ';', '|', '&', '\n'])

/** Splits a shell command into simple commands of words; quotes keep a word whole. Best effort. */
export function splitCommands(command: string): string[][] {
  const commands: string[][] = []
  let words: string[] = []
  let word = ''
  let hasWord = false
  let quote: '"' | "'" | null = null
  const endWord = () => {
    if (hasWord) words.push(word)
    word = ''
    hasWord = false
  }
  const endCommand = () => {
    endWord()
    if (words.length > 0) commands.push(words)
    words = []
  }
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? ''
    if (quote !== null) {
      if (char === quote) quote = null
      else word += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      hasWord = true
      continue
    }
    const pair = command.slice(index, index + 2)
    if (pair === '&&' || pair === '||') {
      endCommand()
      index += 1
      continue
    }
    if (SEPARATORS.has(char)) {
      endCommand()
      continue
    }
    if (char === ' ' || char === '\t') {
      endWord()
      continue
    }
    word += char
    hasWord = true
  }
  endCommand()
  return commands
}

function selectorTarget(word: string, repo: string | null): PrTarget | null {
  const url = PR_URL.exec(word)
  if (url) return { repo: url[1] ?? '', pr: Number(url[2]) }
  const number = /^#?(\d+)$/.exec(word)
  if (number && repo !== null) return { repo, pr: Number(number[1]) }
  return null
}

/**
 * The PR a Bash command acts on: `gh pr merge|close|comment|review|edit` with a
 * number (read against `-R/--repo` or `sessionRepo`) or a PR URL. Null for
 * reads, other verbs, and a call with no selector (the current branch's PR,
 * which only gh can resolve).
 */
export function prTarget(command: string, sessionRepo: string | null): PrTarget | null {
  for (const words of splitCommands(command)) {
    const verb = words[2] ?? ''
    if (words[0] !== 'gh' || words[1] !== 'pr' || !Object.hasOwn(BOOLEAN_FLAGS, verb)) continue
    const booleans = BOOLEAN_FLAGS[verb] ?? new Set<string>()
    let repo = sessionRepo
    let selector: string | null = null
    for (let index = 3; index < words.length; index += 1) {
      const word = words[index] ?? ''
      if (word === '-R' || word === '--repo') {
        repo = words[index + 1] ?? repo
        index += 1
      } else if (word.startsWith('--repo=')) {
        repo = word.slice('--repo='.length)
      } else if (word.startsWith('-')) {
        if (!word.includes('=') && !booleans.has(word)) index += 1
      } else if (selector === null) {
        selector = word
      }
    }
    const target = selector === null ? null : selectorTarget(selector, repo)
    if (target !== null) return target
  }
  return null
}

/** `owner/name` from a GitHub remote URL (ssh or https), else null. */
export function repoFromRemote(remote: string | null | undefined): string | null {
  if (!remote) return null
  const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remote.trim())
  return match ? `${match[1]}/${match[2]}` : null
}

/** The other live session that touched `target` inside the lock window, if any. */
export function otherTouch(
  members: readonly PartyMember[],
  selfId: string,
  target: PrTarget,
  now: number,
  lockMs: number,
): { member: PartyMember; touch: PartyTouch } | null {
  for (const one of members) {
    if (one.sessionId === selfId || !isLive(one, now)) continue
    const touch = one.touches.find(
      found => found.repo === target.repo && found.pr === target.pr && now - found.at <= lockMs,
    )
    if (touch) return { member: one, touch }
  }
  return null
}

/** The touches with `target` stamped now: one per PR, expired ones dropped. */
export function addTouch(touches: readonly PartyTouch[], target: PrTarget, now: number, lockMs: number): PartyTouch[] {
  const kept = touches.filter(one => now - one.at <= lockMs && !(one.repo === target.repo && one.pr === target.pr))
  return [...kept, { repo: target.repo, pr: target.pr, at: now }]
}

export function basename(path: string): string {
  const parts = path.split('/').filter(part => part !== '')
  return parts.at(-1) ?? path
}

export const displayName = (one: PartyMember) => (one.title !== '' ? one.title : basename(one.cwd))

export const place = (one: PartyMember) => (one.branch !== '' ? `${basename(one.cwd)}@${one.branch}` : basename(one.cwd))

export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}S`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}M`
  return `${Math.floor(minutes / 60)}H${String(minutes % 60).padStart(2, '0')}`
}

export function lockReason(other: PartyMember, touch: PartyTouch, now: number): string {
  return (
    `PARTY LOCK: another session ("${displayName(other)}", ${place(other)}) acted on ` +
    `${touch.repo}#${touch.pr} ${formatAge(now - touch.at)} AGO. ` +
    'Two sessions acting on one PR collide; allow only if this is meant.'
  )
}

/** The first line of a prompt, cut to 40 columns: a session's title. */
export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0]?.trim() ?? ''
  return line.length > 40 ? line.slice(0, 40) : line
}

export type BarColor = 'lime' | 'yellow' | 'red'

/** HP-style: fills over nagMinutes; full and red once the wait passes it. */
export function waitBar(waitedMs: number, nagMs: number, cells: number): { filled: number; color: BarColor } {
  const ratio = nagMs <= 0 ? 1 : Math.min(1, Math.max(0, waitedMs / nagMs))
  const filled = Math.round(ratio * cells)
  const color: BarColor = ratio >= 1 ? 'red' : ratio >= 0.5 ? 'yellow' : 'lime'
  return { filled, color }
}

export const nagKey = (one: PartyMember) => `${one.sessionId}@${one.since}`

/** Other sessions waiting past nagMinutes that were not toasted for this wait yet. */
export function nagDue(
  members: readonly PartyMember[],
  selfId: string,
  now: number,
  nagMs: number,
  nagged: readonly string[],
): PartyMember[] {
  return members.filter(
    one =>
      one.sessionId !== selfId &&
      one.state === 'waiting-on-you' &&
      now - one.since > nagMs &&
      !nagged.includes(nagKey(one)),
  )
}

export function statusLine(members: readonly PartyMember[]): string {
  const waiting = members.filter(one => one.state === 'waiting-on-you').length
  return `PARTY ${members.length} ▸ ${waiting} WAITING`
}

/** Every other live session still running (a `done` one has ended). */
export const broadcastTargets = (members: readonly PartyMember[], selfId: string) =>
  members.filter(one => one.sessionId !== selfId && one.state !== 'done')

export const STATE_LABEL: Record<PartyState, string> = {
  working: 'WORKING',
  'waiting-on-you': 'WAITING ON YOU',
  idle: 'IDLE',
  done: 'DONE',
}

export const WAIT_LABEL: Record<PartyWait, string> = {
  permission: 'PERMISSION',
  question: 'QUESTION',
  plan: 'PLAN',
}

export function stateText(one: PartyMember): string {
  return one.state === 'waiting-on-you' && one.waitingFor !== null
    ? `${STATE_LABEL[one.state]} · ${WAIT_LABEL[one.waitingFor]}`
    : STATE_LABEL[one.state]
}

/** `1UP` for this session, `2P`, `3P`, ... for the others in roster order. */
export function playerTags(members: readonly PartyMember[], selfId: string): string[] {
  let player = 1
  return members.map(one => (one.sessionId === selfId ? '1UP' : `${(player += 1)}P`))
}

/** The roster as plain text: the `/party` reply where no pane draws. */
export function describeRoster(members: readonly PartyMember[], selfId: string, now: number): string {
  const lines = [statusLine(members)]
  const tags = playerTags(members, selfId)
  members.forEach((one, index) => {
    const tag = tags[index] ?? ''
    const tool = one.lastTool !== '' ? ` · LAST ${one.lastTool}` : ''
    lines.push(`${tag} ${displayName(one)} · ${place(one)} · ${stateText(one)} ${formatAge(now - one.since)}${tool}`)
  })
  return lines.join('\n')
}
