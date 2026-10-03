// prove-it's $.state contract: the last proof, the run in progress and the
// one-shot skip. All of it lives for the session and survives a hot reload.

/**
 * proven: the changed tests fail without the fix and pass with it.
 * not-proven: they pass without the fix, so they do not test it.
 * broken: they fail with the fix.
 * no-tests: source changed but no test file did.
 * no-source: only tests changed and they pass; there is nothing to revert.
 * nothing: no change against the base.
 * error: git or the test command could not run; the tree was restored.
 * restore-failed: a restored file's hash did not match; the copies are kept.
 */
export type ProveVerdict =
  | 'proven'
  | 'not-proven'
  | 'broken'
  | 'no-tests'
  | 'no-source'
  | 'nothing'
  | 'error'
  | 'restore-failed'

/** One test run: its exit code and the last lines it printed. */
export type ProveRun = { exitCode: number; tail: string }

export type ProveProof = {
  verdict: ProveVerdict
  /** The merge base, short. Empty when it was never found. */
  base: string
  sources: string[]
  tests: string[]
  /** Without the fix (sources at the base). */
  without: ProveRun | null
  /** With the fix (sources restored). */
  with: ProveRun | null
  /** Why, for error, restore-failed and the like. */
  detail: string
  /** Where the copies of the changed sources were put aside. */
  copiesDir: string
  /** The state of the change this proof was made for; equal means nothing changed since. */
  fingerprint: string
  at: number
}

/** idle, or which half of the proof is running. */
export type ProvePhase = 'idle' | 'without' | 'with'

declare module 'claude-code' {
  interface PluginState {
    'prove-it': {
      proof: ProveProof | null
      phase: ProvePhase
      /** The token of the proof that holds the run; empty when none does. */
      owner: string
      skipNext: boolean
      isBandHidden: boolean
    }
  }
}
