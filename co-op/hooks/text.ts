/** The words co-op shows: status line, deny text, the model's context note. */
import type { CoopFinding, CoopRun } from '../types'
import { severityCounts } from './review'

const TAG = { high: 'HIGH', medium: 'MED ', low: 'LOW ' } as const

/** `HIGH src/a.ts:12 summary`; with no file, the tag then the summary. */
export const findingLine = (finding: CoopFinding): string => {
  const place = finding.file === '' ? '' : `${finding.file}${finding.line === undefined ? '' : `:${finding.line}`} `
  return `${TAG[finding.severity]} ${place}${finding.summary}`
}

/** `2H 1M 3L`, zeros left out; `0` when there are none. */
export const countsText = (findings: readonly CoopFinding[]): string => {
  const counts = severityCounts(findings)
  const parts = [
    counts.high > 0 ? `${counts.high}H` : '',
    counts.medium > 0 ? `${counts.medium}M` : '',
    counts.low > 0 ? `${counts.low}L` : '',
  ].filter(part => part !== '')
  return parts.length === 0 ? '0' : parts.join(' ')
}

const shorten = (text: string, width: number) => (text.length <= width ? text : `${text.slice(0, width - 1)}+`)

export type Flags = { isReviewing: boolean; skipNext: boolean }

/** The status line, at most 40 columns. */
export const statusText = (run: CoopRun | null, flags: Flags): string => {
  const say = (text: string) => shorten(`CO-OP ▸ ${text}`, 40)
  if (flags.isReviewing) return say('REVIEWING')
  if (flags.skipNext) return say('SKIP NEXT')
  if (run === null) return say('READY')
  switch (run.outcome) {
    case 'pass':
      return say('PASS')
    case 'blocked':
      return say(`FAIL ${countsText(run.findings)}`)
    case 'flagged':
      return say(`FLAGGED ${countsText(run.findings)}`)
    case 'unreadable':
      return say('NO REVIEW')
    case 'skipped':
      return say('SKIPPED')
    case 'empty':
      return say('NO DIFF')
  }
}

const sizeText = (run: CoopRun) =>
  run.isTruncated
    ? `The diff was truncated to the first ${run.maxDiffKb} KB of ${Math.ceil(run.bytes / 1024)} KB, so the rest was not reviewed.`
    : ''

const whoText = (run: CoopRun) =>
  `reviewer ${run.reviewer === '' ? 'none' : run.reviewer}, diff against ${run.base === '' ? 'an unknown base' : run.base}`

const findingsBlock = (findings: readonly CoopFinding[]) =>
  findings.length === 0 ? ['  (no findings)'] : findings.map(finding => `  ${findingLine(finding)}`)

/** What the model reads when `gh pr create` is denied. */
export const denyText = (run: CoopRun): string =>
  [
    `co-op: 2P REVIEW FAILED. gh pr create is BLOCKED (${whoText(run)}).`,
    `Findings (${countsText(run.findings)}):`,
    ...findingsBlock(run.findings),
    sizeText(run),
    'Fix the high findings and run gh pr create again: co-op reviews the new diff. If the user decides the findings are wrong, they can run /coop skip to let the next gh pr create through unreviewed.',
  ]
    .filter(line => line !== '')
    .join('\n')

/** The note the model reads after a `gh pr create` that went through. */
export const contextText = (run: CoopRun): string => {
  if (run.outcome === 'unreadable') {
    return `co-op: the second-model review could not be used (${run.reason ?? 'unknown reason'}), so gh pr create went through unreviewed. Say so if you report on the PR.`
  }
  if (run.outcome === 'skipped') return 'co-op: /coop skip let this gh pr create through without a review.'
  if (run.outcome === 'empty') return `co-op: no diff against ${run.base} to review.`
  const verdict = run.outcome === 'flagged' ? 'FAIL with no high finding, so not blocking' : 'PASS, not blocking'
  return [
    `co-op: 2P REVIEW ${verdict} (${whoText(run)}). Findings (${countsText(run.findings)}):`,
    ...findingsBlock(run.findings),
    sizeText(run),
    run.findings.length > 0 ? 'Consider these before asking for human review.' : '',
  ]
    .filter(line => line !== '')
    .join('\n')
}
