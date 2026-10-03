// mender's $.state contract. Values here live for the session and survive a
// hot reload; learned shapes are mirrored to $.store so they outlive it.

/** A JSON schema object, as the schema file or a learned shape holds it. */
export type MenderSchema = Record<string, unknown>

/** One argument mender changed: where, what kind, from and to (as JSON). */
export type MenderRepair = { path: string; kind: 'boolean' | 'number' | 'array' | 'object' | 'drop'; from: string; to: string }

/** One repaired call. */
export type MenderRepairEntry = { at: number; tool: string; repairs: MenderRepair[] }

/** Schema errors one tool kept returning this session. */
export type MenderToolErrors = { count: number; lastAt: number; last: string }

declare module 'claude-code' {
  interface PluginState {
    mender: {
      /** Recent repaired calls, newest last (capped). */
      repairs: MenderRepairEntry[]
      /** Calls repaired this session. */
      fixed: number
      /** Schema/validation errors that still came back, per tool. */
      errors: Record<string, MenderToolErrors>
      /** Servers that look down, with why; cleared when a call to one succeeds. */
      down: Record<string, string>
      /** Schemas from the schema file, per tool. */
      schemas: Record<string, MenderSchema>
      /** What the schema file load said ('' when it loaded or is absent). */
      schemaProblem: string
      /** Shapes learned from validation errors (mirrors $.store). */
      learned: Record<string, MenderSchema>
      /** `/mender off` for this session. */
      isOff: boolean
    }
  }
}
