/** What a session is doing, as the raid frame shows it. */
export type PartyState = 'working' | 'waiting-on-you' | 'idle' | 'done'

/** What a waiting session waits for: a permission prompt, a question, or a plan to approve. */
export type PartyWait = 'permission' | 'question' | 'plan'

/** One PR action a session took: the lock other sessions check. */
export type PartyTouch = {
  /** `owner/name` from the remote or the PR URL, or the repository root when there is no GitHub remote. */
  repo: string
  pr: number
  /** When it ran, in ms since the epoch. */
  at: number
}

/** One session's heartbeat, kept in the plugin store under `session:<id>`. */
export type PartyMember = {
  sessionId: string
  /** The session's first prompt, cut short; empty until the first turn. */
  title: string
  cwd: string
  branch: string
  /** The repository key PR numbers without a URL are read against, or null outside a repository. */
  repo: string | null
  state: PartyState
  /** When the session entered `state`, in ms since the epoch. */
  since: number
  /** What it waits for while `waiting-on-you`; null otherwise. */
  waitingFor: PartyWait | null
  /** The last tool the session called, or an empty string. */
  lastTool: string
  /** When this entry was last written, in ms since the epoch. */
  beatAt: number
  /** PR actions inside the lock window. */
  touches: PartyTouch[]
}

declare module 'claude-code' {
  interface PluginState {
    party: {
      /** This session's own entry, as the next heartbeat will write it. */
      self: PartyMember
      /** Every live session (this one included), as the last heartbeat read them. */
      roster: PartyMember[]
      /** `<sessionId>@<since>` of every wait already toasted. */
      nagged: string[]
    }
  }
}
