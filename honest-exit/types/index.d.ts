// honest-exit's $.state contract. Values live for the session and survive a
// hot reload.

export type HonestExitKind = 'no-match' | 'not-found' | 'hidden-exit'

export type HonestExitCatch = {
  kind: HonestExitKind
  /** The command as it ran, cut to a short line. */
  command: string
  /** What gave it away: the glob, the missing name, or the failure word. */
  clue: string
  /** Set when a subagent's call was caught. */
  agentId?: string
  /** When it was caught, in ms since the epoch. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'honest-exit': {
      /** How many failures were caught this session. */
      caught: number
      /** The most recent catches, newest last. */
      log: HonestExitCatch[]
    }
  }
}
