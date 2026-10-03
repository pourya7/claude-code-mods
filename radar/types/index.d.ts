// radar's $.state contract. The index and the pings live for the session and
// survive a hot reload; nothing goes to $.store and no memory file is written.

export type RadarMemory = {
  /** The file's absolute path: the memory's identity. */
  file: string
  name: string
  description: string
  /** Regex sources from the frontmatter's `triggers:`, each one compiled once to check it. */
  triggers: string[]
  /** Body lines that say never / always / don't / must. */
  rules: string[]
  /** Distinctive tokens of the name and description (the ones few memories share). */
  keywords: string[]
}

export type RadarPing = {
  /** When, in ms since the epoch. */
  at: number
  tool: string
  /** The memory's name. */
  memory: string
  /** `trigger` or `keywords`: which rule matched. */
  reason: 'trigger' | 'keywords'
}

declare module 'claude-code' {
  interface PluginState {
    radar: {
      memories: RadarMemory[]
      /** Files skipped at the last index, with the reason. */
      problems: string[]
      /** The folders the last index read. */
      sources: string[]
      /** Newest last, at most 20. */
      pings: RadarPing[]
      /** Every ping this session. */
      pingCount: number
      /** Files attached during the main loop's current turn. */
      attached: string[]
    }
  }
}
