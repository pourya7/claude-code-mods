import { describe, expect, test } from 'claude-code/testing'

import {
  baseFlagOf,
  buildReviewPrompt,
  byteLength,
  hashText,
  isBlocking,
  isPrCreate,
  leadingCdOf,
  parseReview,
  pickReviewerModel,
  severityCounts,
  splitArgv,
  truncateDiff,
} from '../hooks/review'

describe('isPrCreate', () => {
  test('sees gh pr create however it is written', () => {
    for (const command of [
      'gh pr create --fill',
      'gh pr create',
      "cd '/work/app' && gh pr create --title 'x' --body 'y'",
      'git push -u origin HEAD && gh pr create --fill',
      'gh -R acme/app pr create --fill',
      'gh --repo acme/app pr create',
      'GH_PROMPT_DISABLED=1 gh pr create --fill',
      'gh pr new --fill',
      '/opt/homebrew/bin/gh pr create --fill',
      './bin/gh pr new',
      'command gh pr create --fill',
      'if true; then gh pr create --fill; fi',
      'git push && (gh pr create --fill)',
      'echo "$(gh pr create --fill)"',
      'gh pr create --title "x" --body "$(cat <<\'EOF\'\nSummary: fix the refund\n\nRun gh pr view after.\nEOF\n)"',
      'cat <<EOF > body.md && gh pr create --body-file body.md\nhello\nEOF',
      'gh pr create --help; gh pr create --fill',
    ]) {
      expect(isPrCreate(command)).toBe(true)
    }
  })

  test('ignores gh pr create inside quotes, heredoc bodies and help', () => {
    for (const command of [
      'git commit -m "fix: refund; then gh pr create later"',
      'git commit -m "docs: explain gh pr create flow"',
      "git commit -m 'a; gh pr create'",
      'printf "%s" x\\;gh pr create',
      'cat <<EOF > notes.md\ngh pr create --fill\nEOF',
      'gh pr create --help',
      'gh pr create -h',
      'gh pr new --help',
    ]) {
      expect(isPrCreate(command)).toBe(false)
    }
  })

  test('leaves other gh and git commands alone', () => {
    for (const command of [
      'gh pr view 42',
      'gh pr list',
      'gh pr checks 42',
      'git commit -m "create the PR later"',
      'gh pr created',
      'gh issue create',
      'echo hi',
    ]) {
      expect(isPrCreate(command)).toBe(false)
    }
  })
})

describe('baseFlagOf', () => {
  test('reads --base and -B in every spelling', () => {
    expect(baseFlagOf('gh pr create --base develop --fill')).toBe('develop')
    expect(baseFlagOf('gh pr create --base=release/2.0')).toBe('release/2.0')
    expect(baseFlagOf("gh pr create -B 'main'")).toBe('main')
    expect(baseFlagOf('gh pr create --fill')).toBeUndefined()
  })
})

describe('leadingCdOf', () => {
  test('finds the directory a leading cd moves to', () => {
    expect(leadingCdOf("cd '/work/my app' && gh pr create")).toBe('/work/my app')
    expect(leadingCdOf("cd '/work/it'\\''s' && gh pr create")).toBe("/work/it's")
    expect(leadingCdOf('cd "/work/app" && gh pr create')).toBe('/work/app')
    expect(leadingCdOf('cd ~/work/app && gh pr create')).toBe('~/work/app')
    expect(leadingCdOf('gh pr create')).toBeUndefined()
  })
})

describe('truncateDiff', () => {
  test('keeps a small diff whole', () => {
    const diff = 'diff --git a/x b/x\n+one\n'
    expect(truncateDiff(diff, 200)).toEqual({ text: diff, isTruncated: false, bytes: byteLength(diff) })
  })

  test('cuts a big diff at a line boundary under the limit and says so', () => {
    const line = `+${'a'.repeat(99)}\n`
    const diff = line.repeat(30)
    const cut = truncateDiff(diff, 1)
    expect(cut.isTruncated).toBe(true)
    expect(cut.bytes).toBe(3030)
    expect(byteLength(cut.text)).toBeLessThanOrEqual(1024)
    expect(cut.text.endsWith('\n')).toBe(true)
    expect(cut.text).toBe(line.repeat(10))
  })

  test('counts bytes, not characters', () => {
    expect(byteLength('a')).toBe(1)
    expect(byteLength('é')).toBe(2)
    expect(byteLength('█')).toBe(3)
    expect(byteLength('\u{1F600}')).toBe(4)
  })
})

describe('parseReview', () => {
  test('reads a plain JSON verdict', () => {
    const parsed = parseReview(
      '{"verdict":"fail","findings":[{"severity":"high","file":"src/a.ts","line":12,"summary":"Null deref"}]}',
    )
    expect(parsed).toEqual({
      review: { verdict: 'fail', findings: [{ severity: 'high', file: 'src/a.ts', line: 12, summary: 'Null deref' }] },
    })
  })

  test('reads JSON inside a fence with prose around it', () => {
    const parsed = parseReview('Here you go:\n```json\n{"verdict": "PASS", "findings": []}\n```\nDone.')
    expect(parsed).toEqual({ review: { verdict: 'pass', findings: [] } })
  })

  test('normalises severities and drops findings with no summary', () => {
    const parsed = parseReview(
      JSON.stringify({
        verdict: 'fail',
        findings: [
          { severity: 'critical', file: 'a', summary: 'one' },
          { severity: 'Major', file: 'b', line: '7', summary: 'two' },
          { severity: 'moderate', summary: 'three' },
          { severity: 'nit', file: 'c', summary: 'four' },
          { severity: 'high', file: 'd' },
        ],
      }),
    )
    expect(parsed).toEqual({
      review: {
        verdict: 'fail',
        findings: [
          { severity: 'high', file: 'a', summary: 'one' },
          { severity: 'high', file: 'b', line: 7, summary: 'two' },
          { severity: 'medium', file: '', summary: 'three' },
          { severity: 'low', file: 'c', summary: 'four' },
        ],
      },
    })
  })

  test('says why unreadable output cannot be used', () => {
    expect(parseReview('Looks good to me!')).toEqual({ reason: 'no JSON object in the reply' })
    expect(parseReview('{"verdict": "maybe", "findings": []}')).toEqual({
      reason: 'verdict must be "pass" or "fail"',
    })
    expect(parseReview('{"verdict": "pass", ')).toEqual({ reason: 'no JSON object in the reply' })
    expect(parseReview('{"verdict": "pass", "findings": "none"}')).toEqual({ reason: 'findings must be a list' })
  })
})

describe('gate', () => {
  test('blocks only a fail verdict with a high finding', () => {
    const high = { severity: 'high' as const, file: 'a', summary: 's' }
    const low = { severity: 'low' as const, file: 'a', summary: 's' }
    expect(isBlocking({ verdict: 'fail', findings: [high] })).toBe(true)
    expect(isBlocking({ verdict: 'fail', findings: [low] })).toBe(false)
    expect(isBlocking({ verdict: 'pass', findings: [high] })).toBe(false)
    expect(severityCounts([high, low, high])).toEqual({ high: 2, medium: 0, low: 1 })
  })
})

describe('pickReviewerModel', () => {
  test('uses the configured model when there is one', () => {
    expect(pickReviewerModel('haiku', 'claude-opus-5')).toBe('haiku')
  })

  test('picks another tier than the session model', () => {
    expect(pickReviewerModel('', 'claude-opus-5-5')).toBe('sonnet')
    expect(pickReviewerModel('', 'claude-sonnet-5')).toBe('opus')
    expect(pickReviewerModel('', 'haiku')).toBe('sonnet')
  })

  test('falls back to the session model when it cannot tell', () => {
    expect(pickReviewerModel('', 'some-custom-model')).toBe('some-custom-model')
    expect(pickReviewerModel('', '')).toBe('sonnet')
  })
})

describe('splitArgv', () => {
  test('splits on spaces and honours quotes', () => {
    expect(splitArgv('my-reviewer --json -')).toEqual(['my-reviewer', '--json', '-'])
    expect(splitArgv(`review "two words" 'single quoted' plain`)).toEqual([
      'review',
      'two words',
      'single quoted',
      'plain',
    ])
    expect(splitArgv('   ')).toEqual([])
  })
})

describe('buildReviewPrompt', () => {
  test('carries the diff, the base and the truncation note, and treats the diff as data', () => {
    const prompt = buildReviewPrompt({ diff: '+x\n', base: 'origin/main', isTruncated: true, bytes: 300_000, maxDiffKb: 200 })
    expect(prompt).toContain('origin/main')
    expect(prompt).toContain('+x')
    expect(prompt).toContain('TRUNCATED')
    expect(prompt).toContain('"verdict"')
    expect(prompt.toLowerCase()).toContain('data')
  })
})

describe('hashText', () => {
  test('is stable and tells different diffs apart', () => {
    expect(hashText('abc')).toBe(hashText('abc'))
    expect(hashText('abc')).not.toBe(hashText('abd'))
  })
})
