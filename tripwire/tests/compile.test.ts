import { describe, expect, test } from 'claude-code/testing'

import { COMPILE_EXAMPLES, buildCompilePrompt, parseProposal, uniqueId } from '../hooks/compile'

describe('buildCompilePrompt', () => {
  test('carries the schema, three examples and the sentence', () => {
    const prompt = buildCompilePrompt('never deploy on fridays')
    expect(COMPILE_EXAMPLES).toHaveLength(3)
    for (const example of COMPILE_EXAMPLES) {
      expect(prompt).toContain(example.sentence)
      expect(prompt).toContain(JSON.stringify(example.rule))
    }
    expect(prompt).toContain('"action"')
    expect(prompt).toContain('deny | ask | rewrite | note')
    expect(prompt).toContain('never deploy on fridays')
  })
})

describe('parseProposal', () => {
  const rule = {
    id: 'no-friday-deploy',
    tool: 'Bash',
    match: 'deploy',
    field: 'command',
    action: 'ask',
    message: 'Confirm a deploy.',
  }

  test('reads a bare JSON object', () => {
    expect(parseProposal(JSON.stringify(rule))).toEqual({ rule })
  })

  test('reads JSON wrapped in prose and a code fence', () => {
    const text = 'Here you go:\n```json\n' + JSON.stringify(rule, null, 2) + '\n```\nDone.'
    expect(parseProposal(text)).toEqual({ rule })
  })

  test('explains output that is not JSON', () => {
    const parsed = parseProposal('I cannot do that.')
    expect(parsed).toHaveProperty('reason')
    expect((parsed as { reason: string }).reason).toMatch(/JSON/)
  })

  test('explains JSON that is not a valid rule', () => {
    const parsed = parseProposal(JSON.stringify({ ...rule, match: '(' }))
    expect((parsed as { reason: string }).reason).toMatch(/regex/)
    const unknown = parseProposal(JSON.stringify({ ...rule, action: 'nuke' }))
    expect((unknown as { reason: string }).reason).toMatch(/action/)
  })
})

describe('uniqueId', () => {
  test('suffixes an id already taken', () => {
    expect(uniqueId('a', [])).toBe('a')
    expect(uniqueId('a', ['a'])).toBe('a-2')
    expect(uniqueId('a', ['a', 'a-2'])).toBe('a-3')
  })
})
