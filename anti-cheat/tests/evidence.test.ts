import { describe, expect, test } from 'claude-code/testing'

import type { AntiCheatCheck, AntiCheatEntry } from '../types'
import { appendEntry, challengeText, foulLine, unverifiedClaims } from '../hooks/evidence'

const edit = (seq: number): AntiCheatEntry => ({ seq, type: 'edit', path: '/repo/a.ts' })
const run = (seq: number, checks: AntiCheatCheck[], isOk = true, command = 'npm test'): AntiCheatEntry => ({ seq, type: 'run', checks, command, isOk })

describe('unverifiedClaims', () => {
  test('a claim with no evidence is a foul', () => {
    expect(unverifiedClaims([{ kind: 'test', quote: 'tests pass' }], [edit(1)])).toEqual([
      { kind: 'test', quote: 'tests pass', reason: 'no test ran after the last edit' },
    ])
  })

  test('a passing run after the last edit backs the claim', () => {
    expect(unverifiedClaims([{ kind: 'test', quote: 'tests pass' }], [edit(1), run(2, ['test'])])).toEqual([])
  })

  test('a run before the last edit does not count', () => {
    const fouls = unverifiedClaims([{ kind: 'test', quote: 'tests pass' }], [run(1, ['test']), edit(2)])
    expect(fouls).toHaveLength(1)
  })

  test('a failing last run is a foul', () => {
    const fouls = unverifiedClaims([{ kind: 'test', quote: 'tests pass' }], [edit(1), run(2, ['test'], true), run(3, ['test'], false, 'pytest -x')])
    expect(fouls[0]?.reason).toBe('the last test run failed (pytest -x)')
  })

  test('with no edit at all, any passing run this session counts', () => {
    expect(unverifiedClaims([{ kind: 'lint', quote: 'lint is clean' }], [run(1, ['lint'])])).toEqual([])
    expect(unverifiedClaims([{ kind: 'lint', quote: 'lint is clean' }], [])[0]?.reason).toBe('no lint or typecheck ran this session')
  })

  test('CI needs a check after the last push', () => {
    const claim = [{ kind: 'ci' as const, quote: 'CI green' }]
    expect(unverifiedClaims(claim, [run(1, ['ci']), run(2, ['push'], true, 'git push')])[0]?.reason).toBe('no CI check ran after the last push')
    expect(unverifiedClaims(claim, [run(1, ['push'], true, 'git push'), run(2, ['ci'], true, 'gh pr checks')])).toEqual([])
  })

  test('a run that is not a pass says why', () => {
    const claim = [{ kind: 'test' as const, quote: 'tests pass' }]
    const noted = (note: 'masked' | 'background' | 'interrupted', command: string): AntiCheatEntry => ({ seq: 2, type: 'run', checks: ['test'], command, isOk: false, note })
    expect(unverifiedClaims(claim, [edit(1), noted('masked', 'pytest | tail -20')])[0]?.reason).toBe(
      "the last test run's exit status was hidden by a pipe or a later command (pytest | tail -20)",
    )
    expect(unverifiedClaims(claim, [edit(1), noted('background', 'npm test')])[0]?.reason).toBe('the last test run is still in the background (npm test)')
    expect(unverifiedClaims(claim, [edit(1), noted('interrupted', 'npm test')])[0]?.reason).toBe('the last test run was interrupted (npm test)')
  })

  test('a CI status read backs nothing, and never outweighs a real check', () => {
    const claim = [{ kind: 'ci' as const, quote: 'CI is green' }]
    const push = run(1, ['push'], true, 'git push')
    const read: AntiCheatEntry = { seq: 3, type: 'run', checks: ['ci'], command: 'gh run view 123', isOk: false, note: 'read' }
    expect(unverifiedClaims(claim, [push, { ...read, seq: 2 }])[0]?.reason).toBe('the CI status was only read (gh run view 123), which exits 0 even when CI fails')
    expect(unverifiedClaims(claim, [push, run(2, ['ci'], true, 'gh pr checks 42'), read])).toEqual([])
    expect(unverifiedClaims(claim, [push, run(2, ['ci'], false, 'gh pr checks 42'), read])[0]?.reason).toBe('the last CI check run failed (gh pr checks 42)')
  })

  test('a push whose status a pipe hid still starts the CI window', () => {
    const claim = [{ kind: 'ci' as const, quote: 'CI is green' }]
    const maskedPush: AntiCheatEntry = { seq: 2, type: 'run', checks: ['push'], command: 'git push | tail', isOk: false, note: 'masked' }
    expect(unverifiedClaims(claim, [run(1, ['ci'], true, 'gh pr checks'), maskedPush])[0]?.reason).toBe('no CI check ran after the last push')
  })

  test('verified needs any passing check after the last edit', () => {
    const claim = [{ kind: 'verified' as const, quote: 'verified it works' }]
    expect(unverifiedClaims(claim, [edit(1)])[0]?.reason).toBe('no check ran after the last edit')
    expect(unverifiedClaims(claim, [edit(1), run(2, ['build'], true, 'npm run build')])).toEqual([])
  })
})

describe('appendEntry', () => {
  test('numbers entries in order and keeps the log bounded', () => {
    let log: AntiCheatEntry[] = []
    for (let index = 0; index < 250; index += 1) {
      log = appendEntry(log, { type: 'edit', path: `/f${index}` })
    }
    expect(log).toHaveLength(200)
    expect(log[0]?.seq).toBe(51)
    expect(log[199]?.seq).toBe(250)
  })
})

describe('texts', () => {
  const foul = { kind: 'test' as const, quote: 'tests pass', reason: 'no test ran after the last edit' }

  test('foul line', () => {
    expect(foulLine(foul)).toBe('⚑ FOUL: "tests pass" — no test ran after the last edit')
  })

  test('challenge prompt', () => {
    expect(challengeText([foul])).toBe('anti-cheat: you said "tests pass" but no test ran after the last edit. Run the check now and report the real result.')
  })
})
