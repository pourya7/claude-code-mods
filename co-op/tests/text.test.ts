import { describe, expect, test } from 'claude-code/testing'

import type { CoopRun } from '../types'
import { contextText, countsText, denyText, findingLine, statusText } from '../hooks/text'
import { PALETTE, TWO_PLAYERS, pixelRows } from '../hooks/pixels'

const run = (over: Partial<CoopRun>): CoopRun => ({
  outcome: 'pass',
  findings: [],
  base: 'origin/main',
  reviewer: 'model:opus',
  isTruncated: false,
  bytes: 1200,
  maxDiffKb: 200,
  at: 0,
  trigger: 'pr-create',
  ...over,
})

const HIGH = { severity: 'high' as const, file: 'src/pay.ts', line: 42, summary: 'Refund runs twice on retry.' }
const LOW = { severity: 'low' as const, file: '', summary: 'Log line has no context.' }

describe('statusText', () => {
  test('says the state in a short arcade line', () => {
    expect(statusText(null, { isReviewing: false, skipNext: false })).toBe('CO-OP ▸ READY')
    expect(statusText(null, { isReviewing: true, skipNext: false })).toBe('CO-OP ▸ REVIEWING')
    expect(statusText(null, { isReviewing: false, skipNext: true })).toBe('CO-OP ▸ SKIP NEXT')
    expect(statusText(run({}), { isReviewing: false, skipNext: false })).toBe('CO-OP ▸ PASS')
    expect(statusText(run({ outcome: 'blocked', findings: [HIGH, HIGH, LOW] }), { isReviewing: false, skipNext: false })).toBe(
      'CO-OP ▸ FAIL 2H 1L',
    )
    expect(statusText(run({ outcome: 'flagged', findings: [LOW] }), { isReviewing: false, skipNext: false })).toBe(
      'CO-OP ▸ FLAGGED 1L',
    )
    expect(statusText(run({ outcome: 'unreadable' }), { isReviewing: false, skipNext: false })).toBe('CO-OP ▸ NO REVIEW')
    expect(statusText(run({ outcome: 'skipped' }), { isReviewing: false, skipNext: false })).toBe('CO-OP ▸ SKIPPED')
    expect(statusText(run({ outcome: 'empty' }), { isReviewing: false, skipNext: false })).toBe('CO-OP ▸ NO DIFF')
  })

  test('stays under 40 columns', () => {
    const many = Array.from({ length: 120 }, () => HIGH)
    expect(statusText(run({ outcome: 'blocked', findings: [...many, LOW] }), { isReviewing: false, skipNext: false }).length).toBeLessThanOrEqual(40)
  })
})

describe('findings as text', () => {
  test('one line per finding, with the place when there is one', () => {
    expect(findingLine(HIGH)).toBe('HIGH src/pay.ts:42 Refund runs twice on retry.')
    expect(findingLine(LOW)).toBe('LOW  Log line has no context.')
    expect(countsText([HIGH, LOW, LOW])).toBe('1H 2L')
    expect(countsText([])).toBe('0')
  })

  test('the deny names the findings, the base and both ways out', () => {
    const text = denyText(run({ outcome: 'blocked', findings: [HIGH, LOW], isTruncated: true, bytes: 300_000 }))
    expect(text).toContain('gh pr create')
    expect(text).toContain('BLOCKED')
    expect(text).toContain('HIGH src/pay.ts:42 Refund runs twice on retry.')
    expect(text).toContain('origin/main')
    expect(text).toContain('/coop skip')
    expect(text).toContain('truncated')
  })

  test('the context note says the PR went through and lists findings', () => {
    const text = contextText(run({ outcome: 'flagged', findings: [LOW] }))
    expect(text).toContain('co-op')
    expect(text).toContain('LOW  Log line has no context.')
    expect(text).toContain('not blocking')
    expect(contextText(run({ outcome: 'unreadable', reason: 'no JSON object in the reply' }))).toContain(
      'no JSON object in the reply',
    )
  })
})

describe('pixels', () => {
  test('the two players fold into three rows of PICO-8 runs', () => {
    const rows = pixelRows(TWO_PLAYERS)
    expect(rows).toHaveLength(3)
    const colors = new Set(Object.values(PALETTE))
    for (const row of rows) {
      for (const cell of row) {
        if (cell.color) expect(colors.has(cell.color as never)).toBe(true)
        if (cell.backgroundColor) expect(colors.has(cell.backgroundColor as never)).toBe(true)
        expect(/^[▀▄ ]+$/.test(cell.text)).toBe(true)
      }
      expect(row.reduce((width, cell) => width + cell.text.length, 0)).toBe(11)
    }
    expect(rows.flat().some(cell => cell.color === PALETTE.u || cell.backgroundColor === PALETTE.u)).toBe(true)
  })
})
