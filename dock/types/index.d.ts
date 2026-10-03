/** What dock could read from docker: `ok`, or why not. */
export type DockHealth = 'ok' | 'no-docker' | 'daemon-down' | 'error'

/** One compose project, as `docker compose ls` names it. */
export type DockStack = {
  name: string
  /** The compose working dir (label `com.docker.compose.project.working_dir`), or null when unknown. */
  workingDir: string | null
  /** The working dir no longer exists: the worktree that booted it is gone. */
  isOrphan: boolean
  /** Compose's status as a short label, e.g. `UP 2` or `UP 1 OFF 1`. */
  stateLabel: string
  isRunning: boolean
  containers: number
  /** Memory its running containers use now, in bytes. */
  memoryBytes: number
}

/** One read of docker. */
export type DockSnapshot = {
  health: DockHealth
  /** Why docker could not be read; empty when `health` is ok. */
  message: string
  /** When it was read, in ms since the epoch. */
  checkedAt: number
  /** Memory the engine has, in bytes (`docker info` MemTotal). */
  totalBytes: number
  /** Memory every running container uses, in bytes, stack or not. */
  usedBytes: number
  /** Biggest first. */
  stacks: DockStack[]
}

declare module 'claude-code' {
  interface PluginState {
    dock: {
      snapshot: DockSnapshot | null
      /** The session's working directory, to mark the stack booted from here. */
      cwd: string
    }
  }
}
