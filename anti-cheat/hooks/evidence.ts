import type { AntiCheatCheck, AntiCheatClaim, AntiCheatClaimKind, AntiCheatEntry, AntiCheatFoul, AntiCheatRunNote } from '../types'

/** How many entries the session log keeps; older ones fall off the front. */
export const LOG_LIMIT = 200

export type NewEntry =
  | { type: 'edit'; path: string }
  | { type: 'run'; checks: AntiCheatCheck[]; command: string; isOk: boolean; note?: AntiCheatRunNote }

/** Adds an entry with the next sequence number, keeping the newest LOG_LIMIT. */
export const appendEntry = (log: readonly AntiCheatEntry[], entry: NewEntry): AntiCheatEntry[] => {
  const seq = (log[log.length - 1]?.seq ?? 0) + 1
  return [...log, { ...entry, seq } as AntiCheatEntry].slice(-LOG_LIMIT)
}

/** Which runs back a claim, and what the reasons call them. */
const EVIDENCE: Record<AntiCheatClaimKind, { checks: AntiCheatCheck[]; noun: string; ranNoun: string }> = {
  test: { checks: ['test'], noun: 'test', ranNoun: 'no test' },
  lint: { checks: ['lint'], noun: 'lint or typecheck', ranNoun: 'no lint or typecheck' },
  build: { checks: ['build'], noun: 'build', ranNoun: 'no build' },
  ci: { checks: ['ci'], noun: 'CI check', ranNoun: 'no CI check' },
  verified: { checks: ['test', 'lint', 'build', 'ci'], noun: 'check', ranNoun: 'no check' },
}

const lastSeq = (log: readonly AntiCheatEntry[], isMarker: (entry: AntiCheatEntry) => boolean) =>
  [...log].reverse().find(isMarker)?.seq

/** A push counts as made when it passed, or when a pipe hid whether it did. */
const isPush = (entry: AntiCheatEntry) =>
  entry.type === 'run' && entry.checks.includes('push') && (entry.isOk || entry.note === 'masked')

const shorten = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 3)}...` : text)

/** Why the last run of a kind does not back a claim. */
const whyNot = (note: AntiCheatRunNote | undefined, noun: string, command: string) => {
  const quoted = `(${shorten(command, 40)})`
  switch (note) {
    case 'masked':
      return `the last ${noun} run's exit status was hidden by a pipe or a later command ${quoted}`
    case 'background':
      return `the last ${noun} run is still in the background ${quoted}`
    case 'interrupted':
      return `the last ${noun} run was interrupted ${quoted}`
    case 'read':
      return `the CI status was only read ${quoted}, which exits 0 even when CI fails`
    default:
      return `the last ${noun} run failed ${quoted}`
  }
}

/**
 * The claims nothing in the log backs up. A claim needs a passing run of its
 * kind after the last edit (for CI, after the last push), the last such run
 * being the one that counts; with no edit (or push) at all, any run counts.
 * A CI query that only reads a status never outweighs a real check, but on
 * its own it backs nothing.
 */
export const unverifiedClaims = (claims: readonly AntiCheatClaim[], log: readonly AntiCheatEntry[]): AntiCheatFoul[] =>
  claims.flatMap(claim => {
    const { checks, noun, ranNoun } = EVIDENCE[claim.kind]
    const isCi = claim.kind === 'ci'
    const since = isCi ? lastSeq(log, isPush) : lastSeq(log, entry => entry.type === 'edit')
    const runs = log.filter(
      (entry): entry is AntiCheatEntry & { type: 'run' } =>
        entry.type === 'run' && entry.seq > (since ?? 0) && entry.checks.some(check => checks.includes(check)),
    )
    const checked = runs.filter(entry => entry.note !== 'read')
    const last = checked[checked.length - 1] ?? runs[runs.length - 1]

    if (last === undefined) {
      const when = since === undefined ? 'this session' : isCi ? 'after the last push' : 'after the last edit'
      return [{ ...claim, reason: `${ranNoun} ran ${when}` }]
    }
    if (!last.isOk || last.note !== undefined) {
      return [{ ...claim, reason: whyNot(last.note, noun, last.command) }]
    }
    return []
  })

/** The band's and the transcript notice's line for one foul. */
export const foulLine = (foul: AntiCheatFoul) => `⚑ FOUL: "${foul.quote}" — ${foul.reason}`

/** The prompt Challenge submits: every foul, then the ask. */
export const challengeText = (fouls: readonly AntiCheatFoul[]) =>
  `anti-cheat: ${fouls.map(foul => `you said "${foul.quote}" but ${foul.reason}`).join('; ')}. Run the check now and report the real result.`
