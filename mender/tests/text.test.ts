import { describe, expect, test } from 'claude-code/testing'

import { downNote, factText, learnedNote, repairLine, repairNote, shortTool, statusText } from '../hooks/text'

describe('repair notes', () => {
  test('each repair is one line the model can learn from', () => {
    expect(repairLine({ path: 'draft', kind: 'boolean', from: '"true"', to: 'true' })).toBe('draft: "true" → true (boolean)')
    expect(repairLine({ path: 'colour', kind: 'drop', from: '"red"', to: '' })).toBe(
      'colour: dropped (the schema allows no such key)',
    )
  })

  test('the note names the tool and every repair', () => {
    const note = repairNote('mcp__notes__create', [
      { path: 'draft', kind: 'boolean', from: '"true"', to: 'true' },
      { path: 'ids', kind: 'array', from: '7', to: '[7]' },
    ])
    expect(note).toContain('mcp__notes__create')
    expect(note).toContain('- draft: "true" → true (boolean)')
    expect(note).toContain('- ids: 7 → [7] (array)')
    expect(note).toMatch(/send them in this shape/i)
  })
})

describe('learned notes', () => {
  test('facts read as sentences', () => {
    expect(factText({ path: ['filter', 'limit'], expected: 'integer' })).toBe('filter.limit must be integer')
    expect(factText({ path: [], rejectKeys: ['colour', 'size'] })).toBe('no key colour, size at the top level')
  })

  test('with a repaired shape, the note shows it', () => {
    const note = learnedNote('mcp__notes__create', [{ path: ['draft'], expected: 'boolean' }], { draft: true })
    expect(note).toContain('draft must be boolean')
    expect(note).toContain('{"draft":true}')
  })
})

describe('down notes', () => {
  test('tell the model to stop retrying', () => {
    const note = downNote('notes', 'needs auth')
    expect(note).toContain('notes')
    expect(note).toMatch(/stop retrying/i)
    expect(note).toContain('/mcp')
  })
})

describe('status', () => {
  test('quiet when nothing happened', () => {
    expect(statusText({ fixed: 0, errors: 0, down: 0 })).toBeUndefined()
  })

  test('short, under 40 columns', () => {
    const text = statusText({ fixed: 12, errors: 3, down: 1 })
    expect(text).toBe('MENDER ▸ 12 FIXED · 3 ERR · 1 DOWN')
    expect(text!.length).toBeLessThanOrEqual(40)
    expect(statusText({ fixed: 2, errors: 0, down: 0 })).toBe('MENDER ▸ 2 FIXED')
  })

  test('tool names shorten to server/tool', () => {
    expect(shortTool('mcp__notes__create_note')).toBe('notes/create_note')
    expect(shortTool('Bash')).toBe('Bash')
  })
})
