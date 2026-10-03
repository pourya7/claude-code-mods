import type { StanceName } from '../types'

export type Stance = StanceName

export const STANCES: readonly Stance[] = ['investigate', 'draft', 'build', 'ship']

export type StanceInfo = {
  /** The UPPERCASE arcade name. */
  title: string
  /** The button label. */
  short: string
  /** The PICO-8 colour the name is drawn in. */
  color: string
  /** One line under the name in the band. */
  tagline: string
  /** The stance in a few plain words, for deny messages. */
  summary: string
  /** What the model reads while the stance holds; empty for build. */
  rules: string
  /** Higher is stricter; auto-detect never lowers an explicit stance. */
  strictness: number
}

export const STANCE_INFO: Record<Stance, StanceInfo> = {
  investigate: {
    title: 'INVESTIGATE',
    short: 'INV',
    color: '#29ADFF',
    tagline: 'FINDINGS ONLY. NO EDITS, COMMITS OR PRS.',
    summary: 'findings only: no edits, commits or PRs',
    rules:
      'Findings only. Do not edit files (except under the OS temp dir or the session scratchpad); do not git commit/push/branch/merge/rebase/cherry-pick or create worktrees; do not use gh to create, edit, comment on, review, merge or close PRs, issues or releases, or call gh api with a write method; do not call MCP tools that send, post, create, save, update, delete, merge, comment, reply or publish. Report what you found in chat.',
    strictness: 3,
  },
  draft: {
    title: 'DRAFT',
    short: 'DRAFT',
    color: '#FFEC27',
    tagline: 'WORK LOCALLY. NO PUSH, PR OR POST.',
    summary: 'work locally: no push, PR, issue or MCP post',
    rules:
      'Work locally: no push, PR, issue or MCP post. Edits and local commits are fine; do not git push; do not use gh to create, edit, comment on, review, merge or close PRs, issues or releases, or call gh api with a write method; do not call MCP tools that send, post, create, save, update, delete, merge, comment, reply or publish. Show drafts in chat instead.',
    strictness: 2,
  },
  build: {
    title: 'BUILD',
    short: 'BUILD',
    color: '#FFA300',
    tagline: 'FULL POWER. NO LIMITS FROM STANCE.',
    summary: 'no limits',
    rules: '',
    strictness: 1,
  },
  ship: {
    title: 'SHIP',
    short: 'SHIP',
    color: '#00E436',
    tagline: 'VERIFY BEFORE YOU MERGE: TESTS, CI, REVIEW.',
    summary: 'verify before merging',
    rules: 'Shipping. Before merging, re-run the tests, check CI on the head commit and read the review comments; report the evidence.',
    strictness: 1,
  },
}

const ALIASES: Record<string, Stance> = {
  investigate: 'investigate',
  investigation: 'investigate',
  inv: 'investigate',
  draft: 'draft',
  build: 'build',
  ship: 'ship',
}

/** A stance from what the person typed (`INV`, ` draft `), or undefined. */
export const parseStance = (text: string): Stance | undefined => ALIASES[text.trim().toLowerCase()]

/** What the model reads while `stance` holds, or undefined in build. */
export const modelNote = (stance: Stance): string | undefined => {
  const info = STANCE_INFO[stance]
  if (info.rules === '') return undefined
  return `[stance] The session is in ${info.title} stance (enforced by the stance mod). ${info.rules} The person switches with /stance <investigate|draft|build|ship>.`
}
