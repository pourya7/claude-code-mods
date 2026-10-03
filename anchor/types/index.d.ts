/** Where the session is pinned, as anchor keeps it in $.state. */
export type AnchorPoint = {
  /** False after `/anchor off`: a pure pass-through until re-anchored. */
  isOn: boolean
  /** The directory every Bash call starts in. */
  path: string
  /** The top of the git worktree holding `path` (or `path` outside git), spelled like `path`. */
  root: string
  /** The primary checkout when `root` is a linked worktree, else null; spelled like `path`. */
  primary: string | null
  /** `root` as git prints it, symlinks resolved, when that differs. */
  realRoot?: string
  /** `primary` as git prints it, symlinks resolved, when that differs. */
  realPrimary?: string | null
  /** The worktree's folder name, for the status line. */
  name: string
  /** The checked-out branch, or null when detached or outside git. */
  branch: string | null
}

/**
 * A subagent that does not share the session's directory: one spawned with
 * its own `cwd` gets its own anchor (`point`); one in an isolated worktree
 * (or remote) gets `point: null`, and its calls pass through untouched.
 */
export type AgentAnchor = { point: AnchorPoint | null }

declare module 'claude-code' {
  interface PluginState {
    anchor: {
      current: AnchorPoint | null
      agents: StateFamily<AgentAnchor>
    }
  }
}
