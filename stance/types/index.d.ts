export type StanceName = 'investigate' | 'draft' | 'build' | 'ship'

/** Who put the session in its current stance. */
export type StanceSource = 'default' | 'person' | 'auto'

export type StanceState = {
  stance: StanceName
  source: StanceSource
  /** The stance the person last chose with /stance or a band button; auto-detect never loosens below it. */
  personStance?: StanceName
}

declare module 'claude-code' {
  interface PluginState {
    stance: { current: StanceState }
  }
}
