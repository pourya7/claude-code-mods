import type { PromptOrigin } from 'claude-code'

import type { RespawnRun } from '../types'

export const PLUGIN = 'respawn'
export const HOUR_MS = 60 * 60 * 1000
export const BACKOFF_SECONDS: readonly number[] = [10, 30, 60, 120, 300]
export const DEFAULT_PROMPT = 'continue'

export const IDLE_RUN: RespawnRun = {
  phase: 'idle',
  attempt: 0,
  dueAt: 0,
  secondsLeft: 0,
  spentAt: [],
  minutesToLife: 0,
  isOff: false,
}

/** Seconds to wait before the continue of a given step (0 = first). */
export const backoffSeconds = (attempt: number): number =>
  BACKOFF_SECONDS[Math.min(Math.max(0, attempt), BACKOFF_SECONDS.length - 1)] ?? 300

/** The spend times still inside the rolling hour. */
export const recentSpends = (spentAt: readonly number[], now: number): number[] =>
  spentAt.filter(at => now - at < HOUR_MS)

export const livesLeft = (spentAt: readonly number[], lives: number, now: number): number =>
  Math.max(0, lives - recentSpends(spentAt, now).length)

export const hearts = (left: number, total: number): string =>
  '♥'.repeat(Math.max(0, left)) + '♡'.repeat(Math.max(0, total - left))

/** Whole minutes until the oldest life spent this hour comes back; 0 when none is spent. */
export const minutesToNextLife = (spentAt: readonly number[], now: number): number => {
  const oldest = recentSpends(spentAt, now)[0]

  return oldest === undefined ? 0 : Math.max(1, Math.ceil((oldest + HOUR_MS - now) / 60_000))
}

/** GAME OVER holds; only the lives coming back over the hour move. */
export const refreshGameOver = (run: RespawnRun, now: number): RespawnRun => ({
  ...run,
  spentAt: recentSpends(run.spentAt, now),
  minutesToLife: minutesToNextLife(run.spentAt, now),
})

/**
 * A turn died on an error: count down at this step, or GAME OVER when out of
 * lives. GAME OVER itself holds: only a user prompt (cancelRun) leaves it.
 */
export const startCountdown = (run: RespawnRun, now: number, lives: number): RespawnRun => {
  if (run.phase === 'gameover') return refreshGameOver(run, now)
  const spentAt = recentSpends(run.spentAt, now)
  if (livesLeft(spentAt, lives, now) === 0) return refreshGameOver({ ...run, spentAt, phase: 'gameover', secondsLeft: 0 }, now)
  const seconds = backoffSeconds(run.attempt)

  return { ...run, spentAt, phase: 'countdown', dueAt: now + seconds * 1000, secondsLeft: seconds }
}

/** A continue was submitted: one life gone, the next error waits longer. */
export const spendLife = (run: RespawnRun, now: number): RespawnRun => ({
  ...run,
  phase: 'idle',
  attempt: run.attempt + 1,
  secondsLeft: 0,
  spentAt: [...recentSpends(run.spentAt, now), now],
})

/** Success, the user, or `/respawn off`: stop counting and start the backoff over. */
export const cancelRun = (run: RespawnRun): RespawnRun => ({ ...run, phase: 'idle', attempt: 0, secondsLeft: 0 })

export const tickRun = (run: RespawnRun, now: number): RespawnRun => ({
  ...run,
  secondsLeft: Math.max(0, Math.ceil((run.dueAt - now) / 1000)),
})

export const isOwnPrompt = (origin: PromptOrigin): boolean => origin.kind === 'plugin' && origin.name === PLUGIN

/** The person: typed at the composer, sent from a phone, or the SDK host's own turn. */
export const isUserPrompt = (origin: PromptOrigin): boolean =>
  origin.kind === 'composer' || origin.kind === 'bridge' || origin.kind === 'sdk'

export const continuePrompt = (configured: unknown): string =>
  typeof configured === 'string' && configured.trim() !== '' ? configured : DEFAULT_PROMPT

export const livesOption = (configured: unknown): number =>
  typeof configured === 'number' && Number.isFinite(configured) ? Math.max(0, Math.floor(configured)) : 3

/** The status line under the prompt (under ~40 columns), or undefined when idle. */
export const statusLine = (run: RespawnRun, lives: number, now: number): string | undefined => {
  const life = hearts(livesLeft(run.spentAt, lives, now), lives)
  if (run.phase === 'countdown') return `RESPAWN CONTINUE? ${run.secondsLeft} ${life}`
  if (run.phase === 'gameover') return `RESPAWN GAME OVER ${life}`

  return undefined
}

/** What `/respawn` answers. */
export const describeRun = (run: RespawnRun, lives: number, now: number): string => {
  const left = livesLeft(run.spentAt, lives, now)
  const life = `${hearts(left, lives)} ${left}/${lives} lives this hour`
  const next = `next wait ${backoffSeconds(run.attempt)}s`
  if (run.isOff) return `RESPAWN OFF. ${life}. /respawn on to arm it again.`
  if (run.phase === 'countdown') return `CONTINUE? ${run.secondsLeft} ${life}. /respawn off cancels.`
  if (run.phase === 'gameover') return `GAME OVER ${life}. Respawn waits for your next prompt.`

  return `READY! ${life}, ${next}. Watching for turns that die on an API error.`
}
