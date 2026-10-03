import { describe, expect, test } from 'claude-code/testing'

import {
  MAX_SLOTS,
  NOTE_MARKER,
  SAVE_PROMPT,
  isSaveNote,
  parseSave,
  percentOption,
  pickSlot,
  pushSlot,
  saveMarkdown,
  saveNote,
  slotList,
  shouldShowBand,
  touchSession,
  withNote,
  writeFileOption,
} from '../hooks/save'
import type { Slot } from '../hooks/save'

const AT = Date.UTC(2026, 9, 3, 12, 4)

const FULL = {
  goal: 'Ship the retry fix for the uploader',
  step: 'Writing the regression test',
  cwd: '~/work/app',
  branch: 'fix/upload-retry',
  links: ['PR #42', 'https://api.example.com/docs'],
  decisions: ['Retry 3 times with jitter'],
  rules: ['No force push', 'Ask before opening a PR'],
  next: 'Run the test suite',
}

const slot = (goal: string, at = AT): Slot => ({ at, trigger: 'manual', save: { ...FULL, goal } })

describe('the save prompt', () => {
  test('asks for every field as JSON', () => {
    for (const key of ['goal', 'step', 'cwd', 'branch', 'links', 'decisions', 'rules', 'next']) {
      expect(SAVE_PROMPT).toContain(`"${key}"`)
    }
    expect(SAVE_PROMPT).toContain('JSON')
  })
})

describe('parseSave', () => {
  test('reads plain JSON', () => {
    expect(parseSave(JSON.stringify(FULL))).toEqual(FULL)
  })

  test('reads JSON inside a fenced block with words around it', () => {
    const text = `Here is the save:\n\`\`\`json\n${JSON.stringify(FULL, null, 2)}\n\`\`\`\nDone.`
    expect(parseSave(text)).toEqual(FULL)
  })

  test('fills missing fields and drops non-string list items', () => {
    const save = parseSave('{"goal":"g","links":["a",3,null,"b"],"rules":"one rule"}')
    expect(save).toEqual({
      goal: 'g',
      step: '',
      cwd: '',
      branch: '',
      links: ['a', 'b'],
      decisions: [],
      rules: ['one rule'],
      next: '',
    })
  })

  test('keeps unreadable text as notes rather than losing it', () => {
    const save = parseSave('I was fixing the uploader; next run the tests.')
    expect(save.goal).toBe('')
    expect(save.notes).toBe('I was fixing the uploader; next run the tests.')
  })
})

describe('slots', () => {
  test('newest first, capped at 5', () => {
    let slots: Slot[] = []
    for (let i = 1; i <= 7; i += 1) slots = pushSlot(slots, slot(`goal ${i}`))
    expect(MAX_SLOTS).toBe(5)
    expect(slots.map(s => s.save.goal)).toEqual(['goal 7', 'goal 6', 'goal 5', 'goal 4', 'goal 3'])
  })

  test('a cap from the caller wins', () => {
    const slots = pushSlot([slot('a'), slot('b')], slot('c'), 2)
    expect(slots.map(s => s.save.goal)).toEqual(['c', 'a'])
  })

  test('pickSlot reads 1-based slot numbers, newest is 1', () => {
    const slots = [slot('newest'), slot('older')]
    expect(pickSlot(slots, '')?.save.goal).toBe('newest')
    expect(pickSlot(slots, '2')?.save.goal).toBe('older')
    expect(pickSlot(slots, '3')).toBeUndefined()
    expect(pickSlot(slots, 'x')).toBeUndefined()
  })

  test('the list shows each slot on one line', () => {
    const text = slotList([slot('Ship the fix'), slot('Earlier goal', AT - 3_600_000)])
    expect(text).toContain('1 ★ 2026-10-03 12:04 MANUAL  Ship the fix')
    expect(text).toContain('2 ● 2026-10-03 11:04 MANUAL  Earlier goal')
  })

  test('only the 20 most recent sessions keep their slots', () => {
    expect(touchSession(undefined, 'a')).toEqual({ keep: ['a'], drop: [] })
    expect(touchSession(['b', 'a', 'c'], 'a')).toEqual({ keep: ['a', 'b', 'c'], drop: [] })
    expect(touchSession(['b', 'c'], 'a', 2)).toEqual({ keep: ['a', 'b'], drop: ['c'] })
  })

  test('an empty list says so', () => {
    expect(slotList([])).toContain('NO SAVES YET')
  })
})

describe('the note the model reads', () => {
  test('carries every field and the marker', () => {
    const note = saveNote(slot('Ship the retry fix for the uploader'), 1)
    expect(note.startsWith(NOTE_MARKER)).toBe(true)
    expect(isSaveNote(note)).toBe(true)
    for (const piece of [
      'GOAL: Ship the retry fix for the uploader',
      'CURRENT STEP: Writing the regression test',
      'WORKING DIRECTORY: ~/work/app (branch fix/upload-retry)',
      '- PR #42',
      '- Retry 3 times with jitter',
      '- No force push',
      'NEXT STEP: Run the test suite',
      'slot 1',
    ]) {
      expect(note).toContain(piece)
    }
  })

  test('leaves out empty sections', () => {
    const note = saveNote({ at: AT, trigger: 'auto', save: parseSave('{"goal":"g"}') }, 1)
    expect(note).not.toContain('DECISIONS')
    expect(note).not.toContain('NEXT STEP')
    expect(note).toContain('GOAL: g')
  })

  test('the markdown mirror has a heading per section', () => {
    const md = saveMarkdown(slot('g'), 'session-1')
    expect(md).toContain('# Quicksave session-1')
    expect(md).toContain('## Goal')
    expect(md).toContain('## Rules the user set')
  })

  test('withNote appends one user message, never twice', () => {
    const messages = [{ role: 'user' as const, text: 'summary', toolUses: [] }]
    const note = saveNote(slot('g'), 1)
    const once = withNote(messages, note)
    expect(once).toHaveLength(2)
    expect(once[1]).toEqual({ role: 'user', text: note, toolUses: [] })
    expect(withNote(once, note)).toHaveLength(2)
  })

  test('withNote replaces an older save note but keeps user text that merely starts with the marker', () => {
    const stale = saveNote(slot('stale old goal'), 3)
    const fresh = saveNote(slot('fresh goal'), 1)
    const chat = { role: 'user' as const, text: 'QUICKSAVE did not run last time?', toolUses: [] }
    const result = withNote([{ role: 'user' as const, text: 'summary', toolUses: [] }, { role: 'user' as const, text: stale, toolUses: [] }, chat], fresh)
    expect(result.map(m => m.text)).toEqual(['summary', chat.text, fresh])
    expect(isSaveNote(chat.text)).toBe(false)
  })
})

describe('the save-point band', () => {
  test('shows only when idle and at or above the threshold', () => {
    expect(shouldShowBand({ percent: 70, threshold: 70, isWorking: false, runningAgents: 0 })).toBe(true)
    expect(shouldShowBand({ percent: 69, threshold: 70, isWorking: false, runningAgents: 0 })).toBe(false)
    expect(shouldShowBand({ percent: 90, threshold: 70, isWorking: true, runningAgents: 0 })).toBe(false)
    expect(shouldShowBand({ percent: 90, threshold: 70, isWorking: false, runningAgents: 1 })).toBe(false)
    expect(shouldShowBand({ percent: undefined, threshold: 70, isWorking: false, runningAgents: 0 })).toBe(false)
  })
})

describe('options', () => {
  test('warnAtPercent defaults to 70 and stays within 1..100', () => {
    expect(percentOption(undefined)).toBe(70)
    expect(percentOption(85)).toBe(85)
    expect(percentOption(0)).toBe(1)
    expect(percentOption(250)).toBe(100)
    expect(percentOption('80')).toBe(70)
  })

  test('writeFile is off unless it is true', () => {
    expect(writeFileOption(undefined)).toBe(false)
    expect(writeFileOption('true')).toBe(false)
    expect(writeFileOption(true)).toBe(true)
  })
})
