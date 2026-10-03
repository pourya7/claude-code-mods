import { describe, expect, test } from 'claude-code/testing'

import { buildIndex, callText, findMatches, tokenize, touchesSources } from '../hooks/match'
import type { ParsedMemory } from '../hooks/memory'

const memory = (name: string, description: string, triggers: string[] = [], rules: string[] = []): ParsedMemory => ({
  file: `/m/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`,
  name,
  description,
  triggers,
  rules,
})

describe('tokenize', () => {
  test('lowercases, splits on punctuation and drops stop-words, short words and numbers', () => {
    expect(tokenize('Never `git checkout --` the DIRTY file in 2026')).toEqual(['git', 'checkout', 'dirty'])
  })

  test('folds a plain plural onto its singular', () => {
    expect(tokenize('worktrees worktree glass')).toEqual(['worktree', 'worktree', 'glass'])
  })
})

describe('callText', () => {
  test('Bash reads the command', () => {
    expect(callText('Bash', { command: 'docker compose up -d', description: 'Start the stack' })).toBe('docker compose up -d')
  })

  test('file tools read the path, web tools the url and query, search tools the pattern', () => {
    expect(callText('Edit', { file_path: '/w/app/auth.ts', old_string: 'secret code', new_string: 'x' })).toBe('/w/app/auth.ts')
    expect(callText('WebFetch', { url: 'https://api.example.com/v1', prompt: 'summarise' })).toBe('https://api.example.com/v1')
    expect(callText('Grep', { pattern: 'TODO', path: 'src' })).toBe('src\nTODO')
  })

  test('MCP reads the tool name and every string argument', () => {
    expect(callText('mcp__tracker__save_issue', { title: 'Fix login', team: 'ops', count: 2, nested: { label: 'bug' } })).toBe(
      'mcp__tracker__save_issue\nFix login\nops\nbug',
    )
  })

  test('every tool, Bash included, is cut to 4000 characters', () => {
    expect(callText('Bash', { command: 'x'.repeat(10_000) })).toHaveLength(4000)
    expect(callText('mcp__a__b', { body: 'x'.repeat(10_000) })).toHaveLength(4000)
  })

  test('other tools give nothing to match', () => {
    expect(callText('Agent', { prompt: 'git push everything' })).toBe('')
  })
})

describe('buildIndex', () => {
  test('keeps the tokens of name and description, dropping ones too many memories share', () => {
    const many = Array.from({ length: 12 }, (_, i) => memory(`Shared topic ${i}`, `widget note number${i}`))
    const index = buildIndex([...many, memory('Docker capacity', 'one widget stack fits the docker vm')])
    const last = index[index.length - 1]
    expect(last?.keywords).toContain('docker')
    expect(last?.keywords).toContain('stack')
    expect(last?.keywords).not.toContain('widget')
  })
})

describe('touchesSources', () => {
  const dirs = ['/home/dev/.claude/projects/-w/memory', '/b/mem']
  test('an absolute or ~ path inside an indexed folder counts', () => {
    expect(touchesSources('/home/dev/.claude/projects/-w/memory/docker.md', dirs, '/home/dev')).toBe(true)
    expect(touchesSources('cat ~/.claude/projects/-w/memory/docker.md', dirs, '/home/dev')).toBe(true)
    expect(touchesSources('ls /b/mem', dirs, '/home/dev')).toBe(true)
    expect(touchesSources("rg x '/b/mem'", dirs, '/home/dev')).toBe(true)
  })
  test('a sibling folder with the same prefix, or an unrelated path, does not', () => {
    expect(touchesSources('ls /b/memories/x.md', dirs, '/home/dev')).toBe(false)
    expect(touchesSources('docker compose up', dirs, '/home/dev')).toBe(false)
    expect(touchesSources('cat ~/b/mem/x.md', dirs, undefined)).toBe(false)
    expect(touchesSources('cat /other/b/mem/x.md', dirs, '/home/dev')).toBe(false)
  })
})

describe('findMatches', () => {
  const index = buildIndex([
    memory('Never checkout a dirty file', 'copy it aside first', ['git checkout --\\s']),
    memory('Docker stack capacity', 'one compose stack per worktree fits the docker vm'),
    memory('Force push', 'never force push shared branches'),
    memory('Release notes', 'write release notes by hand'),
  ])

  test('a trigger regex hit matches', () => {
    const found = findMatches(index, 'git checkout -- src/a.ts', [])
    expect(found.map(hit => [hit.memory.name, hit.reason])).toEqual([['Never checkout a dirty file', 'trigger']])
  })

  test('two distinctive shared tokens match', () => {
    const found = findMatches(index, 'docker compose up -d', [])
    expect(found.map(hit => hit.memory.name)).toEqual(['Docker stack capacity'])
    expect(found[0]?.reason).toBe('keywords')
    expect(found[0]?.hits).toEqual(['docker', 'compose'])
  })

  test('one shared token is not enough', () => {
    expect(findMatches(index, 'docker ps', [])).toEqual([])
  })

  test('an unrelated call matches nothing', () => {
    expect(findMatches(index, 'ls -la', [])).toEqual([])
    expect(findMatches(index, '', [])).toEqual([])
  })

  test('triggers rank before keywords, keywords by overlap, and at most 2 come back', () => {
    const crowded = buildIndex([
      memory('Alpha docker', 'docker compose'),
      memory('Beta docker', 'docker compose stack worktree'),
      memory('Gamma', 'trigger only', ['compose']),
    ])
    const found = findMatches(crowded, 'docker compose up stack worktree', [])
    expect(found.map(hit => hit.memory.name)).toEqual(['Gamma', 'Beta docker'])
  })

  test('excluded files are skipped and the next one fills the slot', () => {
    const crowded = buildIndex([
      memory('Alpha docker', 'docker compose'),
      memory('Beta docker', 'docker compose stack'),
      memory('Gamma docker', 'docker compose stack worktree'),
    ])
    const first = findMatches(crowded, 'docker compose stack worktree', [])
    expect(first.map(hit => hit.memory.name)).toEqual(['Gamma docker', 'Beta docker'])
    const second = findMatches(crowded, 'docker compose stack worktree', first.map(hit => hit.memory.file))
    expect(second.map(hit => hit.memory.name)).toEqual(['Alpha docker'])
  })

  test('a trigger is case-insensitive', () => {
    expect(findMatches(index, 'GIT CHECKOUT -- a', []).length).toBe(1)
  })
})
