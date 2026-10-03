import type { AntiCheatClaim, AntiCheatClaimKind } from '../types'

const PASSED = '(?:pass(?:es|ed|ing)?|green|succeed(?:s|ed)?|clean(?:ly)?|ok)'
const LINKS = "(?:\\s+(?:all|now|still|fully|are|is|were|was))*"

/**
 * One pattern per claim kind, written so the match is the claim as quoted:
 * a subject, a few linking words, then a word for success.
 */
const CLAIM_PATTERNS: readonly [AntiCheatClaimKind, RegExp][] = [
  ['ci', new RegExp(`\\b(?:(?:the )?CI|(?:all )?(?<!type[- ])checks|(?:the )?pipeline)${LINKS}\\s+${PASSED}\\b`, 'i')],
  [
    'lint',
    new RegExp(
      `\\b(?:lint(?:ing|er)?|type ?checks?|type-checks?|typecheck(?:ing)?|types|tsc|eslint|ruff|mypy|pyright)${LINKS}\\s+${PASSED}\\b`,
      'i',
    ),
  ],
  ['build', new RegExp(`\\b(?:the )?builds?${LINKS}\\s+${PASSED}\\b`, 'i')],
  [
    'test',
    new RegExp(
      `\\b(?:(?:the|all)\\s+)?(?:\\d+\\s+)?(?:(?:unit|integration|e2e|new)\\s+)?(?:tests?|specs|test suite|suite)${LINKS}\\s+${PASSED}\\b`,
      'i',
    ),
  ],
  [
    'verified',
    /\b(?:verified|confirmed)\b(?:\s+(?:that|it|this|the fix|the change))*\s+(?:works?|is working|fixed|fixes it)\b/i,
  ],
]

/**
 * Words that make a claim conditional or still to come. A condition reaches
 * across "and" ("once the build and the tests pass"), so these are looked
 * for in the whole clause, back to the last punctuation mark.
 */
const CONDITION = /\b(?:unless|until|once|if|whether|make sure|ensure|assuming)\b/i

/**
 * Words that make a claim untrue or unsure. These are looked for only close
 * to the claim (its own words and the few before it, back to the last "and",
 * "but" or "so"), so "fixed the failing test and all tests pass" is a claim.
 */
const NEGATION =
  /\b(?:not|no|never|none|nor|without|fail(?:s|ed|ing)?|yet|should|shall|will|would|could|might|may|must|expect(?:ed)?|hope|probably|likely)\b|n't\b/i

/** How many words before a claim the negation check reads. */
const NEAR_WORDS = 4

/** The clause a claim sits in, from the last punctuation mark before it. */
const clauseBefore = (sentence: string, index: number) => {
  const start = Math.max(...[',', ';', ':', '—', '–', '('].map(mark => sentence.lastIndexOf(mark, index - 1)))
  return sentence.slice(start + 1, index)
}

/** The few words right before a claim, stopping at a conjunction. */
const nearBefore = (clause: string) => {
  const words = clause.trim().split(/\s+/).filter(word => word.length > 0)
  const conjunction = words.map(word => word.toLowerCase()).findLastIndex(word => ['and', 'but', 'so', 'then'].includes(word))
  return words.slice(conjunction + 1).slice(-NEAR_WORDS).join(' ')
}

/** Splits an answer into sentences, dropping fenced code and questions. */
const sentencesOf = (answer: string) =>
  answer
    .replace(/```[\s\S]*?```/g, '\n')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 0 && !sentence.endsWith('?'))

/** The claims an answer makes, one per kind, in the order the kinds are listed. */
export const detectClaims = (answer: string): AntiCheatClaim[] => {
  const claims = new Map<AntiCheatClaimKind, AntiCheatClaim>()

  for (const sentence of sentencesOf(answer)) {
    for (const [kind, pattern] of CLAIM_PATTERNS) {
      if (claims.has(kind)) continue
      const match = pattern.exec(sentence)
      if (!match) continue
      const clause = clauseBefore(sentence, match.index)
      if (CONDITION.test(`${clause} ${match[0]}`)) continue
      if (NEGATION.test(`${nearBefore(clause)} ${match[0]}`)) continue
      claims.set(kind, { kind, quote: match[0].replace(/\s+/g, ' ').trim() })
    }
  }

  return [...claims.values()]
}
