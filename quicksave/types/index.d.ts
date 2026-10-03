export type QuicksaveBand = {
  /** The context window's fill from the last measurement, 0 to 100; absent until one (and after a compaction). */
  percent?: number
  /** The slot number the band last saved to, shown as SAVED ★ SLOT n until the next measurement. */
  savedSlot?: number
  /** True while a save's fork runs; the band shows SAVING and its buttons join that save. */
  isSaving?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    quicksave: { band: QuicksaveBand }
  }
}
