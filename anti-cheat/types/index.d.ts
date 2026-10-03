/** What a check command proved: the kinds of evidence a Bash run counts as. */
export type AntiCheatCheck = 'test' | 'lint' | 'build' | 'ci' | 'push'

/** What an answer can claim. */
export type AntiCheatClaimKind = 'test' | 'lint' | 'build' | 'ci' | 'verified'

/**
 * Why a run that is not a pass is not a fail either: its exit status was
 * hidden by a pipe, `||` or a later command; it only read a CI status; it
 * moved to the background; or it was interrupted.
 */
export type AntiCheatRunNote = 'masked' | 'read' | 'background' | 'interrupted'

/** One row of the session's ordered evidence log. */
export type AntiCheatEntry =
  | { seq: number; type: 'edit'; path: string }
  | { seq: number; type: 'run'; checks: AntiCheatCheck[]; command: string; isOk: boolean; note?: AntiCheatRunNote }

/** One claim found in an answer, as quoted. */
export type AntiCheatClaim = { kind: AntiCheatClaimKind; quote: string }

/** A claim that nothing in the log backs up, and why. */
export type AntiCheatFoul = AntiCheatClaim & { reason: string }

declare module 'claude-code' {
  interface PluginState {
    'anti-cheat': {
      log: AntiCheatEntry[]
      fouls: AntiCheatFoul[]
      /** True while the turn running was started by this mod's own auto-challenge. */
      isChallenging: boolean
    }
  }
}
