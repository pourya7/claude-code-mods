import { describe, expect, test } from 'claude-code/testing'

import {
  evaluate,
  fieldText,
  parseRuleFile,
  toolMatches,
  validateRule,
} from '../hooks/rules'
import type { Rule } from '../hooks/rules'

const DENY_FORCE: Rule = {
  id: 'no-force-push',
  tool: 'Bash',
  match: 'git push .*--force(?!-with-lease)',
  field: 'command',
  action: 'deny',
  message: 'Force pushes rewrite shared history.',
  cite: 'memory/never-force-push.md',
}

describe('validateRule', () => {
  test('accepts a well-formed rule', () => {
    expect(validateRule(DENY_FORCE, 0)).toEqual({ rule: DENY_FORCE })
  })

  test('rejects a bad regex with the reason', () => {
    const result = validateRule({ ...DENY_FORCE, match: 'git push (' }, 2)
    expect(result).toHaveProperty('problem')
    expect((result as { problem: string }).problem).toMatch(/no-force-push/)
    expect((result as { problem: string }).problem).toMatch(/regex/i)
  })

  test('rejects an unknown action', () => {
    const result = validateRule({ ...DENY_FORCE, action: 'explode' }, 0)
    expect((result as { problem: string }).problem).toMatch(/action/)
  })

  test('rejects a rewrite without replace or field', () => {
    const noReplace = validateRule({ ...DENY_FORCE, action: 'rewrite' }, 0)
    expect((noReplace as { problem: string }).problem).toMatch(/replace/)
    const noField = validateRule(
      { ...DENY_FORCE, action: 'rewrite', replace: 'x', field: undefined },
      0,
    )
    expect((noField as { problem: string }).problem).toMatch(/field/)
  })

  test('rejects missing id, tool, match or message, and non-objects', () => {
    expect(validateRule({ ...DENY_FORCE, id: '' }, 4)).toHaveProperty('problem')
    expect(validateRule({ ...DENY_FORCE, tool: 3 }, 0)).toHaveProperty('problem')
    expect(validateRule({ ...DENY_FORCE, match: undefined }, 0)).toHaveProperty('problem')
    expect(validateRule({ ...DENY_FORCE, message: '' }, 0)).toHaveProperty('problem')
    expect(validateRule('nope', 0)).toHaveProperty('problem')
  })
})

describe('parseRuleFile', () => {
  test('reads a bare array or { rules }, skipping and reporting bad rules', () => {
    const text = JSON.stringify({
      rules: [DENY_FORCE, { ...DENY_FORCE, id: 'broken', match: '(' }],
    })
    const parsed = parseRuleFile(text, 'user')
    expect(parsed.rules.map(rule => rule.id)).toEqual(['no-force-push'])
    expect(parsed.rules[0]?.source).toBe('user')
    expect(parsed.problems).toHaveLength(1)
    expect(parsed.problems[0]).toMatch(/user.*broken/)

    expect(parseRuleFile(JSON.stringify([DENY_FORCE]), 'project').rules).toHaveLength(1)
  })

  test('reports a file that is not JSON instead of throwing', () => {
    const parsed = parseRuleFile('{ nope', 'project')
    expect(parsed.rules).toEqual([])
    expect(parsed.problems[0]).toMatch(/project.*JSON/)
  })
})

describe('toolMatches', () => {
  test('exact names, * and globs', () => {
    expect(toolMatches('Bash', 'Bash')).toBe(true)
    expect(toolMatches('Bash', 'Edit')).toBe(false)
    expect(toolMatches('*', 'Edit')).toBe(true)
    expect(toolMatches('mcp__*', 'mcp__github__merge')).toBe(true)
    expect(toolMatches('mcp__*', 'Bash')).toBe(false)
    expect(toolMatches('mcp__*__merge', 'mcp__github__merge')).toBe(true)
  })
})

describe('fieldText', () => {
  test('the named field, or the whole input JSON by default', () => {
    expect(fieldText('command', { command: 'ls' })).toBe('ls')
    expect(fieldText(undefined, { url: 'https://api.example.com' })).toBe(
      '{"url":"https://api.example.com"}',
    )
    expect(fieldText('missing', { command: 'ls' })).toBeUndefined()
    expect(fieldText('n', { n: 4 })).toBe('4')
  })
})

describe('evaluate', () => {
  const rewrite: Rule = {
    id: 'lease',
    tool: 'Bash',
    match: '--force\\b(?!-with-lease)',
    field: 'command',
    action: 'rewrite',
    replace: '--force-with-lease',
    message: 'Use a lease.',
  }
  const note: Rule = {
    id: 'checks',
    tool: 'Bash',
    match: 'gh pr checks',
    field: 'command',
    action: 'note',
    message: 'Checks lag a push.',
  }
  const ask: Rule = {
    id: 'host',
    tool: '*',
    match: 'api\\.example\\.com',
    action: 'ask',
    message: 'Protected host.',
  }

  test('deny stops at the first matching deny', () => {
    const outcome = evaluate([DENY_FORCE], [], 'Bash', { command: 'git push origin main --force' })
    expect(outcome.deny?.id).toBe('no-force-push')
    expect(outcome.hits.map(rule => rule.id)).toEqual(['no-force-push'])
  })

  test('rewrite runs before later rules, which see the new input', () => {
    const outcome = evaluate([rewrite, DENY_FORCE], [], 'Bash', {
      command: 'git push origin main --force',
    })
    expect(outcome.deny).toBeUndefined()
    expect(outcome.input).toEqual({ command: 'git push origin main --force-with-lease' })
    expect(outcome.hits.map(rule => rule.id)).toEqual(['lease'])
  })

  test('note and ask are collected, the call allowed', () => {
    const outcome = evaluate([note, ask], [], 'Bash', {
      command: 'gh pr checks 42 && curl https://api.example.com',
    })
    expect(outcome.notes.map(rule => rule.id)).toEqual(['checks'])
    expect(outcome.asks.map(rule => rule.id)).toEqual(['host'])
    expect(outcome.isChanged).toBe(false)
  })

  test('disarmed rules and other tools never match', () => {
    expect(evaluate([DENY_FORCE], ['no-force-push'], 'Bash', { command: 'git push --force' }).hits).toEqual([])
    expect(evaluate([DENY_FORCE], [], 'Edit', { command: 'git push --force' }).hits).toEqual([])
  })
})
