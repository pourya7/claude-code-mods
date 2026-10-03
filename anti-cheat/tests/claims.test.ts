import { describe, expect, test } from 'claude-code/testing'

import { detectClaims } from '../hooks/claims'

const kinds = (answer: string) => detectClaims(answer).map(claim => claim.kind)

describe('detectClaims', () => {
  test('finds test claims', () => {
    expect(kinds('Fixed the parser. All tests pass.')).toEqual(['test'])
    expect(kinds('The 42 unit tests are passing now.')).toEqual(['test'])
    expect(kinds('Tests are green.')).toEqual(['test'])
    expect(kinds('the test suite passes')).toEqual(['test'])
  })

  test('finds lint, build, ci and verified claims', () => {
    expect(kinds('Lint is clean.')).toEqual(['lint'])
    expect(kinds('Typecheck passes.')).toEqual(['lint'])
    expect(kinds('The build passes.')).toEqual(['build'])
    expect(kinds('CI is green.')).toEqual(['ci'])
    expect(kinds('All checks pass on PR #42.')).toEqual(['ci'])
    expect(kinds('CI passing.')).toEqual(['ci'])
    expect(kinds('I verified it works.')).toEqual(['verified'])
    expect(kinds('Confirmed it works end to end.')).toEqual(['verified'])
  })

  test('quotes the claim as written', () => {
    expect(detectClaims('Done, tests pass.')).toEqual([{ kind: 'test', quote: 'tests pass' }])
    expect(detectClaims('CI green, merging.')[0]?.quote).toBe('CI green')
  })

  test('one claim per kind', () => {
    expect(kinds('Tests pass. Really, all tests pass.')).toEqual(['test'])
  })

  test('a negative word earlier in the sentence does not cancel the claim', () => {
    expect(kinds('I fixed the failing test and all tests pass now.')).toEqual(['test'])
    expect(kinds('Removed the flaky retry so it no longer hangs and the tests pass.')).toEqual(['test'])
    expect(kinds('Fixed the flaky test that failed on CI and all tests pass.')).toEqual(['test'])
    expect(kinds('Made it a no-op and the tests pass.')).toEqual(['test'])
    expect(kinds('Fixed the failing assertion and all tests pass now.')).toEqual(['test'])
  })

  test('negations are not claims', () => {
    expect(kinds('Not all tests pass.')).toEqual([])
    expect(kinds('None of the tests pass.')).toEqual([])
    expect(kinds('Fixed one, but no tests pass yet.')).toEqual([])
    expect(kinds('The tests do not pass yet.')).toEqual([])
    expect(kinds("Tests aren't passing.")).toEqual([])
    expect(kinds('Tests are not green.')).toEqual([])
    expect(kinds("I haven't verified it works.")).toEqual([])
    expect(kinds('CI is not green yet.')).toEqual([])
    expect(kinds('No tests pass right now.')).toEqual([])
  })

  test('hedges, conditions and questions are not claims', () => {
    expect(kinds('Once the tests pass I will open the PR.')).toEqual([])
    expect(kinds('The tests should pass now.')).toEqual([])
    expect(kinds('Do the tests pass?')).toEqual([])
    expect(kinds('Make sure CI is green before merging.')).toEqual([])
    expect(kinds('If the build and the tests pass, I will merge.')).toEqual([])
  })

  test('ignores fenced code', () => {
    expect(kinds('Output:\n```\n12 tests pass\n```\nThe fix is in.')).toEqual([])
  })

  test('typecheck is lint, not CI', () => {
    expect(kinds('Type checks pass.')).toEqual(['lint'])
  })
})
