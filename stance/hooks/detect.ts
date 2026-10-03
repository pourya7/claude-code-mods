import { STANCE_INFO } from './stances'
import type { Stance } from './stances'
import type { StanceState } from '../types'

const INVESTIGATE_PHRASES = [/\binvestigation (task|only)\b/i, /\bno code\b/i, /\bno commits?\b/i, /\bno PRs?\b/i, /\bfindings only\b/i]
const DRAFT_PHRASES = [/\b(do not|don't|dont) (send|post|reply)\b/i, /\bdraft only\b/i]

/** The stance a prompt asks for in so many words, the stricter when both match. */
export const detectStance = (text: string): Stance | undefined => {
  if (INVESTIGATE_PHRASES.some(phrase => phrase.test(text))) return 'investigate'
  if (DRAFT_PHRASES.some(phrase => phrase.test(text))) return 'draft'
  return undefined
}

export type AutoSwitch = { to: Stance } | { kept: Stance }

/**
 * What auto-detect does with a detected stance: switch to it, keep the
 * stricter stance the person chose themselves (and say so), or nothing when
 * unchanged. A stance auto-detect set may be loosened again by auto-detect,
 * but never below the stance the person chose.
 */
export const autoSwitch = (current: StanceState, detected: Stance): AutoSwitch | undefined => {
  if (current.stance === detected) return undefined
  const floor = current.personStance
  if (floor !== undefined && STANCE_INFO[detected].strictness < STANCE_INFO[floor].strictness) return { kept: floor }
  return { to: detected }
}
