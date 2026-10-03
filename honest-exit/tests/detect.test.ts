import { describe, expect, test } from 'claude-code/testing'

import {
  detect,
  hiddenExitClue,
  noMatchClue,
  notFoundName,
  pipesIntoFilter,
  swallowsStatus,
} from '../hooks/detect'

// `npm test` in demos/project under node v24, with one assertion changed to fail.
const NODE_FAIL = `> cart@1.0.0 test
> node --test

✔ subtotal adds price times quantity (0.390375ms)
✖ applyDiscount takes a percentage off (0.2925ms)
✔ total applies the discount to the subtotal (0.041042ms)
ℹ tests 3
ℹ pass 2
ℹ fail 1
ℹ duration_ms 32.348667

✖ failing tests:

test at test/cart.test.js:14:1
✖ applyDiscount takes a percentage off (0.2925ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  630 !== 631

      at TestContext.<anonymous> (test/cart.test.js:15:10) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 630,
    expected: 631,
    operator: 'strictEqual',
    diff: 'simple'
  }`

// The same run, passing.
const NODE_PASS = `> cart@1.0.0 test
> node --test

✔ subtotal adds price times quantity (0.366208ms)
✔ applyDiscount takes a percentage off (0.05275ms)
✔ total applies the discount to the subtotal (0.038375ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 32.343542`

describe('no matches found', () => {
  test('zsh "no matches found" gives the glob', () => {
    expect(noMatchClue('zsh: no matches found: src/**/*.tsx')).toBe('src/**/*.tsx')
    expect(noMatchClue('Exit code 1\n(eval):1: no matches found: *.log')).toBe('*.log')
  })

  test('bash failglob "no match" and csh-style "No match." are caught', () => {
    expect(noMatchClue('bash: line 1: no match: *.orig')).toBe('*.orig')
    expect(noMatchClue('Exit code 1\nNo match.')).toBe('(a glob)')
  })

  test('an ordinary "No matches found." from a search tool is not a glob failure', () => {
    expect(noMatchClue('No matches found.')).toBeUndefined()
    expect(noMatchClue('grep: no match in 12 files')).toBeUndefined()
    expect(noMatchClue('')).toBeUndefined()
  })

  test('detect explains that the command with the glob never ran, but others on the line may have', () => {
    const [finding] = detect('ls *.tsx', { isError: true, output: 'Exit code 1\nzsh: no matches found: *.tsx' })
    expect(finding?.kind).toBe('no-match')
    expect(finding?.note).toContain("the glob didn't match, so the command that contained it never ran")
    expect(finding?.note).toContain('may still have run')
    expect(finding?.note).not.toContain('Nothing in that command executed')
    expect(finding?.note).toContain('*.tsx')
    expect(finding?.toast).toMatch(/^HONEST EXIT/)
  })
})

describe('command not found', () => {
  test('zsh and bash shapes name the missing command', () => {
    expect(notFoundName('zsh: command not found: ll')).toBe('ll')
    expect(notFoundName('bash: line 1: grep: command not found')).toBe('grep')
    expect(notFoundName('/bin/sh: 1: cp: not found')).toBe('cp')
    expect(notFoundName('bash: rm: command not found')).toBe('rm')
  })

  test('names that are not usually aliased are left alone', () => {
    const findings = detect('frobnicate --now', { isError: true, output: 'zsh: command not found: frobnicate' })
    expect(findings).toEqual([])
  })

  test('an alias-prone name gets a note that agent shells may differ', () => {
    const [finding] = detect('mv a b', { isError: true, output: 'Exit code 127\nzsh: command not found: mv' })
    expect(finding?.kind).toBe('not-found')
    expect(finding?.clue).toBe('mv')
    expect(finding?.note).toContain('agent shells may differ')
    expect(finding?.note).toContain('other commands on the same line')
    expect(finding?.note).not.toContain('Nothing after that point ran')
  })

  test('each of cp, rm, mv, grep, ls is alias-prone', () => {
    for (const name of ['cp', 'rm', 'mv', 'grep', 'ls']) {
      expect(detect(name, { isError: true, output: `zsh: command not found: ${name}` })[0]?.kind).toBe('not-found')
    }
  })

  test('"command not found" quoted inside ordinary output is not a shell error', () => {
    expect(notFoundName('the docs say: if you see "command not found: ls" check PATH')).toBeUndefined()
  })
})

describe('the shell\'s own lines only', () => {
  test('a GLOB or NOT FOUND line on the stdout of a call that succeeded is file content, not the shell', () => {
    expect(detect('cat build.log', { isError: false, output: 'zsh: command not found: cp', stderr: '' })).toEqual([])
    expect(
      detect('grep -rn "no matches found" notes', { isError: false, output: 'notes/a.md:1:no matches found: *.x', stderr: '' }),
    ).toEqual([])
  })

  test('the same line on stderr of a call that exited 0 is still caught (zsh carries on after it)', () => {
    const output = 'a\n(eval):1: no matches found: *.nope\nb'
    const [finding] = detect('echo a; ls *.nope; echo b', { isError: false, output, stderr: '(eval):1: no matches found: *.nope' })
    expect(finding?.kind).toBe('no-match')
    const [missing] = detect('echo a; ll; echo b', { isError: false, output: 'a\nb', stderr: '(eval):1: command not found: ll' })
    expect(missing?.kind).toBe('not-found')
  })
})

describe('pipes and || true', () => {
  test('pipes into head, tail, tee or grep', () => {
    expect(pipesIntoFilter('pytest -q | tail -5')).toBe(true)
    expect(pipesIntoFilter('npm test 2>&1 | head -50')).toBe(true)
    expect(pipesIntoFilter('make build |& tee build.log')).toBe(true)
    expect(pipesIntoFilter('go test ./... | grep -v ok')).toBe(true)
  })

  test('|| is not a pipe, and quoted pipes do not count', () => {
    expect(pipesIntoFilter('pytest || echo nope')).toBe(false)
    expect(pipesIntoFilter("echo 'a | head'")).toBe(false)
    expect(pipesIntoFilter('pytest | sort')).toBe(false)
  })

  test('ends in || true or || :', () => {
    expect(swallowsStatus('pytest || true')).toBe(true)
    expect(swallowsStatus('pytest || :')).toBe(true)
    expect(swallowsStatus('pytest || true;')).toBe(true)
    expect(swallowsStatus('pytest || true && echo done')).toBe(false)
    expect(swallowsStatus('pytest')).toBe(false)
  })
})

describe('hidden exit status', () => {
  test('each failure signature is caught behind a pipe', () => {
    const cases: [string, string][] = [
      ['=== 2 FAILED, 10 passed ===', 'FAILED'],
      ['build failed', 'failed'],
      ['Error: Cannot find module x', 'Error:'],
      ['  ✗ renders the band', '✗'],
      ['  3 failing', '3 failing'],
      ['Traceback (most recent call last):\n  File "x.py"', 'Traceback'],
    ]
    for (const [output, clue] of cases) {
      expect(hiddenExitClue('npm test | tail -20', output, false)).toBe(clue)
    }
  })

  test('|| true hides the status too', () => {
    expect(hiddenExitClue('pytest -q || true', '1 FAILED', false)).toBe('FAILED')
  })

  test('clean output, a real error exit, or no pipe means no note', () => {
    expect(hiddenExitClue('npm test | tail -20', '12 passing\n0 failing', false)).toBeUndefined()
    expect(hiddenExitClue('pytest | tail', '5 passed, 0 failed', false)).toBeUndefined()
    expect(hiddenExitClue('npm test | tail -20', '1 failing', true)).toBeUndefined()
    expect(hiddenExitClue('npm test', '1 failing', false)).toBeUndefined()
  })

  test('set -o pipefail with no || true means the 0 was honest', () => {
    expect(hiddenExitClue('set -o pipefail; npm test | tail', '1 failing', false)).toBeUndefined()
    expect(hiddenExitClue('set -o pipefail; npm test | tail || true', '1 failing', false)).toBe('1 failing')
  })

  test('searching for a failure word is not a failure', () => {
    expect(detect('grep -rn "Error:" src | head -20', { isError: false, output: 'src/a.ts:3:  throw new Error: boom' })).toEqual([])
    expect(detect('git log --oneline | head', { isError: false, output: 'abc123 fix: retry when upload failed' })).toEqual([])
    expect(hiddenExitClue('cat ci.log | tail -50', 'Traceback (most recent call last):\n1 FAILED', false)).toBeUndefined()
    expect(hiddenExitClue('rg -n "FAILED" logs || true', 'logs/a:1 FAILED', false)).toBeUndefined()
  })

  test('only strong signatures count for a program that is not a check, and not when the command spells them', () => {
    expect(hiddenExitClue('python x.py | tee out.log', 'Traceback (most recent call last):', false)).toBe('Traceback')
    expect(hiddenExitClue('./deploy.sh | tail', 'upload failed', false)).toBeUndefined()
    expect(hiddenExitClue('./run.sh FAILED | tail', 'FAILED', false)).toBeUndefined()
    expect(hiddenExitClue('pytest | grep FAILED', 'FAILED tests/a.py::t', false)).toBe('FAILED')
    expect(hiddenExitClue('CI=1 npx jest 2>&1 | head', 'Error: boom', false)).toBe('Error:')
  })

  test('Node\'s built-in test runner (node --test) failing behind a pipe', () => {
    const cases: [string, string][] = [
      ['✖ applyDiscount takes a percentage off (0.29ms)', '✖'],
      ['ℹ pass 2\nℹ fail 1', 'fail 1'],
      ['# pass 2\n# fail 3', 'fail 3'],
      ['  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:', 'AssertionError [ERR_ASSERTION]:'],
      ['  TypeError: x is not a function', 'TypeError:'],
      // All that `npm test 2>&1 | tail -5` shows of the failure: the end of the AssertionError dump.
      ["    actual: 630,\n    expected: 631,\n    operator: 'strictEqual',\n    diff: 'simple'\n  }", "operator: 'strictEqual'"],
    ]
    for (const [output, clue] of cases) {
      expect(hiddenExitClue('npm test 2>&1 | tail -5', output, false)).toBe(clue)
      expect(hiddenExitClue('node --test | tail', output, false)).toBe(clue)
    }
    expect(hiddenExitClue('npm test 2>&1 | tail -40', NODE_FAIL, false)).toBe('✖')
    // A script that runs the tests under another name still gets the summary lines.
    expect(hiddenExitClue('./run-tests.sh | tail', '✖ failing tests:', false)).toBe('failing tests:')
    expect(hiddenExitClue('./run-tests.sh | tail', 'ℹ tests 3\nℹ fail 1', false)).toBe('fail 1')
  })

  test('a passing node --test run, with its "fail 0" summary, means no note', () => {
    expect(hiddenExitClue('npm test 2>&1 | tail -20', NODE_PASS, false)).toBeUndefined()
    expect(hiddenExitClue('node --test | tail', NODE_PASS, false)).toBeUndefined()
    expect(hiddenExitClue('./run-tests.sh | tail', NODE_PASS, false)).toBeUndefined()
    expect(hiddenExitClue('node --test --test-reporter=tap | tail', '# pass 3\n# fail 0\n# cancelled 0', false)).toBeUndefined()
  })

  test('detect explains the pipeline hid the first command\'s status', () => {
    const [finding] = detect('pytest | tail -3', { isError: false, output: 'FAILED tests/test_a.py::test_x' })
    expect(finding?.kind).toBe('hidden-exit')
    expect(finding?.note).toContain('the pipeline hid the exit status of the first command')
    expect(finding?.note).toContain('set -o pipefail')
  })
})

describe('detect', () => {
  test('a clean successful command yields nothing', () => {
    expect(detect('ls', { isError: false, output: 'a\nb' })).toEqual([])
  })

  test('a plain failing command (honest exit code) yields nothing', () => {
    expect(detect('npm test', { isError: true, output: 'Exit code 1\n1 failing' })).toEqual([])
  })
})
