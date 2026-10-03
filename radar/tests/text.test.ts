import { describe, expect, test } from 'claude-code/testing'

import { clockText, contextText, defaultMemoryDir, memoryDirsOf, pingsText, projectSlug, statusText } from '../hooks/text'

describe('memory folders', () => {
  test('the userConfig list splits on commas and newlines and expands ~', () => {
    expect(memoryDirsOf(' ~/notes/memory, /abs/dir \n\n', '/home/dev')).toEqual(['/home/dev/notes/memory', '/abs/dir'])
    expect(memoryDirsOf('', '/home/dev')).toEqual([])
    expect(memoryDirsOf(undefined, '/home/dev')).toEqual([])
  })

  test('the project slug replaces every non-alphanumeric character with a dash', () => {
    expect(projectSlug('/home/dev/work/my_app.v2')).toBe('-home-dev-work-my-app-v2')
  })

  test('the default is autoMemoryDirectory when set, else the project memory folder', () => {
    expect(defaultMemoryDir({ autoMemoryDirectory: '~/mem' }, '/home/dev', undefined, '/work/app')).toBe('/home/dev/mem')
    expect(defaultMemoryDir({}, '/home/dev', undefined, '/work/app')).toBe('/home/dev/.claude/projects/-work-app/memory')
    expect(defaultMemoryDir({}, '/home/dev', '/cfg', '/work/app')).toBe('/cfg/projects/-work-app/memory')
    expect(defaultMemoryDir({ autoMemoryDirectory: 7 }, '/home/dev', undefined, '/work/app')).toBe(
      '/home/dev/.claude/projects/-work-app/memory',
    )
  })
})

describe('text', () => {
  test('the context names the memory and carries its description and rules', () => {
    const text = contextText(
      { file: '/m/dirty.md', name: 'Dirty files', description: 'copy it aside first', triggers: [], rules: ['Never checkout.'], keywords: [] },
      'trigger',
    )
    expect(text).toBe(
      'radar: your memory "Dirty files" (/m/dirty.md) is about this call (trigger match).\ncopy it aside first\nRules:\n- Never checkout.',
    )
  })

  test('no rules means no Rules: block', () => {
    const text = contextText({ file: '/m/a.md', name: 'A', description: 'd', triggers: [], rules: [], keywords: [] }, 'keywords')
    expect(text).not.toContain('Rules:')
  })

  test('the status line is short and counts memories and pings', () => {
    expect(statusText(274, 3)).toBe('RADAR 274 ◉ 3 PINGS')
    expect(statusText(5, 1)).toBe('RADAR 5 ◉ 1 PING')
    expect(statusText(274, 3).length).toBeLessThanOrEqual(40)
  })

  test('clock text is HH:MM', () => {
    expect(clockText(new Date(2026, 9, 3, 9, 5).getTime())).toBe('09:05')
  })

  test('pings list newest first', () => {
    const at = new Date(2026, 9, 3, 9, 5).getTime()
    expect(
      pingsText([
        { at, tool: 'Bash', memory: 'Old', reason: 'keywords' },
        { at, tool: 'Edit', memory: 'New', reason: 'trigger' },
      ]),
    ).toEqual(['09:05  EDIT  New', '09:05  BASH  Old'])
  })
})
