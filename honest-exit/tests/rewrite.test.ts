import { describe, expect, test } from 'claude-code/testing'

import { addPipefail, quoteFlagGlobs, rewriteCommand } from '../hooks/rewrite'

describe('quoteFlagGlobs', () => {
  test('quotes the glob in --include=*.x style flags', () => {
    expect(quoteFlagGlobs('grep -r --include=*.ts foo src')).toBe("grep -r --include='*.ts' foo src")
    expect(quoteFlagGlobs('rg --glob=!*.lock x')).toBe("rg --glob='!*.lock' x")
    expect(quoteFlagGlobs('grep --include=*.ts --exclude=*.d.ts x')).toBe(
      "grep --include='*.ts' --exclude='*.d.ts' x",
    )
  })

  test('leaves brace lists to the shell: grep --include does not expand them', () => {
    expect(quoteFlagGlobs('grep -rn foo --include=*.{ts,tsx} src')).toBe('grep -rn foo --include=*.{ts,tsx} src')
    expect(quoteFlagGlobs('grep -r --include={*.ts,*.tsx} foo .')).toBe('grep -r --include={*.ts,*.tsx} foo .')
    expect(rewriteCommand('grep -r --include={*.ts,*.tsx} foo .').changes).toEqual([])
  })

  test('leaves quoted, glob-free and variable values alone', () => {
    expect(quoteFlagGlobs("grep --include='*.ts' x")).toBe("grep --include='*.ts' x")
    expect(quoteFlagGlobs('grep --include="*.ts" x')).toBe('grep --include="*.ts" x')
    expect(quoteFlagGlobs('git log --format=%H')).toBe('git log --format=%H')
    expect(quoteFlagGlobs('grep --include=$PAT x')).toBe('grep --include=$PAT x')
    expect(quoteFlagGlobs('bash -c "grep --include=*.ts x"')).toBe('bash -c "grep --include=*.ts x"')
  })

  test('is idempotent', () => {
    const once = quoteFlagGlobs('grep -r --include=*.ts foo')
    expect(quoteFlagGlobs(once)).toBe(once)
  })
})

describe('addPipefail', () => {
  test('prefixes set -o pipefail when a test, lint or build command pipes into tail', () => {
    expect(addPipefail('pytest -q | tail -5')).toBe('set -o pipefail; pytest -q | tail -5')
    expect(addPipefail('npm run lint 2>&1 | tail -40')).toBe('set -o pipefail; npm run lint 2>&1 | tail -40')
    expect(addPipefail('cargo build | tail')).toBe('set -o pipefail; cargo build | tail')
  })

  test('leaves other pipelines alone', () => {
    expect(addPipefail('git log | head -5')).toBe('git log | head -5')
    expect(addPipefail('pytest -q')).toBe('pytest -q')
    expect(addPipefail('pytest | grep FAILED')).toBe('pytest | grep FAILED')
    expect(addPipefail('grep -rn pytest src | tail')).toBe('grep -rn pytest src | tail')
  })

  test('never adds pipefail before head: an early exit would turn a pass into status 141', () => {
    expect(addPipefail('npm test 2>&1 | head -20')).toBe('npm test 2>&1 | head -20')
    expect(addPipefail('npm run lint 2>&1 | head -40')).toBe('npm run lint 2>&1 | head -40')
  })

  test('is idempotent and respects a pipefail already set', () => {
    const once = addPipefail('jest | tail')
    expect(addPipefail(once)).toBe(once)
    expect(addPipefail('set -euo pipefail; jest | tail')).toBe('set -euo pipefail; jest | tail')
  })
})

describe('rewriteCommand', () => {
  test('lists every change it made', () => {
    const out = rewriteCommand('grep --include=*.py -r x . && pytest | tail -3')
    expect(out.command).toBe("set -o pipefail; grep --include='*.py' -r x . && pytest | tail -3")
    expect(out.changes).toHaveLength(2)
  })

  test('no change means the same command and no changes', () => {
    expect(rewriteCommand('ls -la')).toEqual({ command: 'ls -la', changes: [] })
  })

  test('is idempotent', () => {
    const once = rewriteCommand('grep --include=*.py -r x . && pytest | tail -3').command
    expect(rewriteCommand(once)).toEqual({ command: once, changes: [] })
  })
})
