// tripwire's $.state contract. Values here live for the session and survive a
// hot reload; hit counts are mirrored to $.store so they outlive the session.

export type TripwireRuleAction = 'deny' | 'ask' | 'rewrite' | 'note'

export type TripwireRule = {
  id: string
  tool: string
  match: string
  field?: string
  action: TripwireRuleAction
  message: string
  cite?: string
  replace?: string
}

export type TripwireArmedRule = TripwireRule & { source: 'user' | 'project' }

export type Hit = { count: number; lastHit: number }
export type Hits = Record<string, Hit>

export type TripwireSprung = { id: string; message: string; cite?: string; tool: string; at: number }

export type TripwireProposal =
  | { sentence: string; rule: TripwireRule }
  | { sentence: string; reason: string }

declare module 'claude-code' {
  interface PluginState {
    tripwire: {
      rules: TripwireArmedRule[]
      problems: string[]
      disarmed: string[]
      hits: Hits
      sprung: TripwireSprung | null
      proposal: TripwireProposal | null
      notice: string | null
    }
  }
}
