import { describe, expect, test } from 'claude-code/testing'

import { parseMemory } from '../hooks/memory'

const FILE = '/home/dev/memory/never-checkout-dirty.md'

const doc = (front: string, body = '') => `---\n${front}\n---\n${body}`

describe('parseMemory', () => {
  test('reads name and description from the frontmatter', () => {
    const parsed = parseMemory(FILE, doc('name: Never checkout a dirty file\ndescription: copy it aside first'))
    expect(parsed).toEqual({
      memory: {
        file: FILE,
        name: 'Never checkout a dirty file',
        description: 'copy it aside first',
        triggers: [],
        rules: [],
      },
    })
  })

  test('unquotes single and double quoted values', () => {
    const parsed = parseMemory(FILE, doc(`name: "A \\"quoted\\" name"\ndescription: 'it''s fine'`))
    expect('memory' in parsed && parsed.memory.name).toBe('A "quoted" name')
    expect('memory' in parsed && parsed.memory.description).toBe("it's fine")
  })

  test('reads triggers as a block list, keeping backslashes in single quotes', () => {
    const parsed = parseMemory(FILE, doc(`name: n\ndescription: d\ntriggers:\n  - 'git checkout --\\s'\n  - "^gh pr merge"`))
    expect('memory' in parsed && parsed.memory.triggers).toEqual(['git checkout --\\s', '^gh pr merge'])
  })

  test('reads triggers as a flow list or a single value', () => {
    const flow = parseMemory(FILE, doc(`name: n\ndescription: d\ntriggers: ['a+b', "c"]`))
    expect('memory' in flow && flow.memory.triggers).toEqual(['a+b', 'c'])
    const single = parseMemory(FILE, doc(`name: n\ndescription: d\ntriggers: 'docker compose up'`))
    expect('memory' in single && single.memory.triggers).toEqual(['docker compose up'])
  })

  test('a folded block scalar joins its indented lines with spaces', () => {
    const parsed = parseMemory(FILE, doc('name: Docker capacity\ndescription: >\n  one compose stack\n  per worktree\ntriggers:\n  - docker'))
    expect('memory' in parsed && parsed.memory.description).toBe('one compose stack per worktree')
    expect('memory' in parsed && parsed.memory.triggers).toEqual(['docker'])
  })

  test('a literal block scalar keeps its lines, and chomping marks are accepted', () => {
    const parsed = parseMemory(FILE, doc('name: n\ndescription: |-\n  first line\n\n  second line'))
    expect('memory' in parsed && parsed.memory.description).toBe('first line\nsecond line')
  })

  test('a comment after a closing quote is dropped', () => {
    const parsed = parseMemory(FILE, doc(`name: 'n' # short\ndescription: "quoted # kept" # note`))
    expect('memory' in parsed && parsed.memory.name).toBe('n')
    expect('memory' in parsed && parsed.memory.description).toBe('quoted # kept')
  })

  test('ignores nested keys such as metadata', () => {
    const parsed = parseMemory(FILE, doc('name: n\ndescription: d\nmetadata:\n  type: feedback\n  scope: global'))
    expect('memory' in parsed).toBe(true)
  })

  test('body lines with never / always / don\'t / must become rules, bullets stripped', () => {
    const body = [
      '# Title',
      'Some background that says nothing.',
      '- **Never** run `git checkout -- <file>` on a dirty file.',
      '* Always copy the file aside first.',
      "Don't trust the index.",
      '1. You must read it back.',
      'Do not delete the copy.',
      '',
    ].join('\n')
    const parsed = parseMemory(FILE, doc('name: n\ndescription: d', body))
    expect('memory' in parsed && parsed.memory.rules).toEqual([
      '**Never** run `git checkout -- <file>` on a dirty file.',
      'Always copy the file aside first.',
      "Don't trust the index.",
      'You must read it back.',
      'Do not delete the copy.',
    ])
  })

  test('rules are capped at 5 and each at 240 characters', () => {
    const body = Array.from({ length: 8 }, (_, i) => `- never ${i} ${'x'.repeat(300)}`).join('\n')
    const parsed = parseMemory(FILE, doc('name: n\ndescription: d', body))
    const rules = 'memory' in parsed ? parsed.memory.rules : []
    expect(rules).toHaveLength(5)
    expect(rules.every(rule => rule.length <= 240)).toBe(true)
  })

  test('CRLF line endings parse the same', () => {
    const parsed = parseMemory(FILE, '---\r\nname: n\r\ndescription: d\r\n---\r\nNever do it.\r\n')
    expect(parsed).toEqual({ memory: { file: FILE, name: 'n', description: 'd', triggers: [], rules: ['Never do it.'] } })
  })

  test('a file with no frontmatter at all is not a memory and is skipped quietly', () => {
    expect(parseMemory('/home/dev/memory/MEMORY.md', '# Memory index\n- [a](a.md)\n')).toEqual({ skip: true })
  })

  describe('malformed frontmatter is a problem, never a throw', () => {
    const cases: [string, string, RegExp][] = [
      ['unclosed', '---\nname: n\ndescription: d\n', /not closed/],
      ['no name', doc('description: d'), /no name/],
      ['no description', doc('name: n'), /no description/],
      ['a line that is not key: value', doc('name: n\ndescription: d\njust words'), /line 3/],
      ['a bad trigger regex', doc("name: n\ndescription: d\ntriggers: ['git push (']"), /bad trigger/],
      ['an unclosed quote', doc('name: "n\ndescription: d'), /quote/],
      ['text after a closing quote', doc('name: "n" extra\ndescription: d'), /after a closing quote/],
      ['triggers as a block scalar', doc('name: n\ndescription: d\ntriggers: |\n  git push'), /block scalar/],
      ['a trigger that nests a repeat', doc("name: n\ndescription: d\ntriggers:\n  - '(\\S+\\s*)+--force'"), /repeat inside a repeat/],
      ['a nested star', doc("name: n\ndescription: d\ntriggers: ['(a*)*b']"), /repeat inside a repeat/],
    ]
    for (const [label, text, reason] of cases) {
      test(label, () => {
        const parsed = parseMemory(FILE, text)
        expect('problem' in parsed).toBe(true)
        expect('problem' in parsed && parsed.problem).toMatch(reason)
        expect('problem' in parsed && parsed.problem).toContain('never-checkout-dirty.md')
      })
    }
  })
})
