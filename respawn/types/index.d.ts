export type RespawnPhase = 'idle' | 'countdown' | 'gameover'

export type RespawnRun = {
  /** idle: nothing to say; countdown: CONTINUE? is ticking; gameover: out of lives. */
  phase: RespawnPhase
  /** Continues spent since the last success or cancel: the backoff step. */
  attempt: number
  /** When the countdown ends, in ms since the epoch. */
  dueAt: number
  /** Whole seconds left on the countdown, as drawn. */
  secondsLeft: number
  /** When each life was spent, in ms since the epoch (last hour kept). */
  spentAt: number[]
  /** GAME OVER: whole minutes until the oldest spent life comes back (0 = none spent). */
  minutesToLife: number
  /** `/respawn off` switched it off for this session. */
  isOff: boolean
}

declare module 'claude-code' {
  interface PluginState {
    respawn: { run: RespawnRun }
  }
}
