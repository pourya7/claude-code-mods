import { describe, expect, test } from 'claude-code/testing'

import { askReason, clockText, noteText, recordHits, statusText, trapText } from '../hooks/text'

const rule = {
  id: 'no-force-push',
  tool: 'Bash',
  match: 'x',
  field: 'command',
  action: 'deny' as const,
  message: 'Force pushes rewrite shared history.',
  cite: 'memory/never-force-push.md',
}

describe('trapText', () => {
  test('names TRAP SPRUNG, the id, the message and the cite', () => {
    const text = trapText(rule)
    expect(text).toContain('TRAP SPRUNG')
    expect(text).toContain('no-force-push')
    expect(text).toContain('Force pushes rewrite shared history.')
    expect(text).toContain('memory/never-force-push.md')
  })

  test('leaves the cite line out when there is none', () => {
    expect(trapText({ ...rule, cite: undefined })).not.toContain('CITE')
  })
})

describe('noteText and askReason', () => {
  test('carry the id and message', () => {
    expect(noteText({ ...rule, action: 'note' })).toMatch(/tripwire note \[no-force-push\]: Force/)
    expect(askReason([{ ...rule, action: 'ask' }, { ...rule, id: 'b', action: 'ask', message: 'B.' }])).toBe(
      'TRIPWIRE [no-force-push] Force pushes rewrite shared history. (memory/never-force-push.md) | [b] B. (memory/never-force-push.md)',
    )
  })
})

describe('recordHits', () => {
  test('counts per rule id and stamps the last hit', () => {
    const once = recordHits({}, ['a', 'b'], 1000)
    const twice = recordHits(once, ['a'], 2000)
    expect(twice).toEqual({ a: { count: 2, lastHit: 2000 }, b: { count: 1, lastHit: 1000 } })
    expect(once).toEqual({ a: { count: 1, lastHit: 1000 }, b: { count: 1, lastHit: 1000 } })
  })
})

describe('statusText and clockText', () => {
  test('status stays short', () => {
    expect(statusText(7, 0)).toBe('▲ TRIPWIRE 7 ARMED')
    expect(statusText(7, 2)).toBe('▲ TRIPWIRE 7 ARMED · 2 BAD')
    expect(statusText(0, 0).length).toBeLessThanOrEqual(40)
  })

  test('clockText is HH:MM or a dash', () => {
    expect(clockText(undefined)).toBe('--:--')
    expect(clockText(Date.UTC(2026, 0, 1, 9, 5))).toMatch(/^\d\d:\d\d$/)
  })
})
