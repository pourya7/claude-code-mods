import { describe, expect, test } from 'claude-code/testing'

import type { ProveProof } from '../types'
import { denyText, gateAllows, gatedCommand, replyText, statusLine, verdictLabel } from '../hooks/verdict'

const PROOF: ProveProof = {
  verdict: 'proven',
  base: 'b4se000',
  sources: ['src/add.ts'],
  tests: ['src/add.test.ts'],
  without: { exitCode: 1, tail: '1 failing' },
  with: { exitCode: 0, tail: '1 passing' },
  detail: '',
  copiesDir: '/tmp/t/prove-it-1000',
  fingerprint: 'abc',
  at: 0,
}

describe('gated commands', () => {
  test('git push and gh pr create are gated, in any position of a compound command', () => {
    expect(gatedCommand('git push')).toBe('git push')
    expect(gatedCommand('git push -u origin feat/x')).toBe('git push')
    expect(gatedCommand('cd ~/work/app && git -C . push origin HEAD')).toBe('git push')
    expect(gatedCommand('npm test; gh pr create --fill')).toBe('gh pr create')
  })

  test('the usual other spellings are gated too', () => {
    for (const command of [
      'command git push',
      'env git push',
      'env GIT_TRACE=1 git push',
      'time git push',
      'time -p git push',
      'nohup git push',
      'sudo git push',
      'sudo -u me git push',
      'exec git push',
      '/usr/bin/git push origin x',
      'git --git-dir .git push',
      'git --git-dir=.git --work-tree ~/work/app push',
      'git -c push.default=current push',
      'git --no-pager push',
      'git \\\n  push origin x',
      'bash -c "git push origin x"',
      "sh -lc 'cd ~/work/app && git push'",
      "eval 'git push'",
      'echo `git push`',
      'echo $(git push)',
      'GIT_SSH_COMMAND=ssh git push',
    ]) {
      expect([command, gatedCommand(command)]).toEqual([command, 'git push'])
    }
    for (const command of ['gh pr new', 'gh pr new --fill', 'gh -R o/r pr create', 'gh --repo o/r pr create', 'gh pr -R o/r create', 'command gh pr create']) {
      expect([command, gatedCommand(command)]).toEqual([command, 'gh pr create'])
    }
  })

  test('look-alikes are not gated', () => {
    expect(gatedCommand('git status')).toBeNull()
    expect(gatedCommand('git stash push')).toBeNull()
    expect(gatedCommand('gh pr view 42')).toBeNull()
    expect(gatedCommand('echo "git pushes are gated"')).toBeNull()
    expect(gatedCommand('git log --grep push')).toBeNull()
    expect(gatedCommand('command git status')).toBeNull()
    expect(gatedCommand('gh pr list --search new')).toBeNull()
    expect(gatedCommand('git commit -c HEAD -m "git push later"')).toBeNull()
    expect(gatedCommand("bash -c 'git status'")).toBeNull()
    expect(gatedCommand('echo push git')).toBeNull()
  })
})

describe('the gate', () => {
  test('lets through proven, test-only and empty changes; refuses the rest', () => {
    expect(gateAllows('proven')).toBe(true)
    expect(gateAllows('no-source')).toBe(true)
    expect(gateAllows('nothing')).toBe(true)
    for (const verdict of ['not-proven', 'broken', 'no-tests', 'error', 'restore-failed'] as const) {
      expect(gateAllows(verdict)).toBe(false)
    }
  })

  test('the deny text names the verdict, the reason and the way out', () => {
    const text = denyText({ ...PROOF, verdict: 'not-proven', without: { exitCode: 0, tail: '1 passing' } }, 'git push')
    expect(text).toContain('NOT PROVEN')
    expect(text).toContain('git push')
    expect(text).toMatch(/pass(es)? without the fix/i)
    expect(text).toContain('/prove skip')
  })
})

describe('labels and lines', () => {
  test('each verdict has an uppercase label; PROVEN carries the star', () => {
    expect(verdictLabel('proven')).toBe('PROVEN ★')
    expect(verdictLabel('not-proven')).toBe('NOT PROVEN')
    expect(verdictLabel('broken')).toBe('BROKEN')
    expect(verdictLabel('no-tests')).toBe('NO TESTS CHANGED')
  })

  test('the status line stays short', () => {
    expect(statusLine(PROOF, 'idle', false)).toBe('PROVE-IT ★ PROVEN')
    expect(statusLine({ ...PROOF, verdict: 'broken' }, 'idle', true)).toBe('PROVE-IT ▸ BROKEN · GATE')
    expect(statusLine(null, 'without', false)).toBe('PROVE-IT ▸ PROVING 1/2')
    expect(statusLine(null, 'with', false)).toBe('PROVE-IT ▸ PROVING 2/2')
    expect(statusLine(null, 'idle', true)).toBe('PROVE-IT ▸ GATE ARMED')
    expect(statusLine(null, 'idle', false)).toBeUndefined()
    for (const verdict of ['proven', 'not-proven', 'broken', 'no-tests', 'no-source', 'nothing', 'error', 'restore-failed'] as const) {
      expect((statusLine({ ...PROOF, verdict }, 'idle', true) ?? '').length).toBeLessThanOrEqual(40)
    }
  })

  test('the reply lists the files, both runs and the base', () => {
    const text = replyText(PROOF)
    expect(text).toContain('PROVEN ★')
    expect(text).toContain('src/add.ts')
    expect(text).toContain('src/add.test.ts')
    expect(text).toMatch(/without the fix: FAIL \(exit 1\)/)
    expect(text).toMatch(/with the fix: PASS/)
    expect(text).toContain('b4se000')
  })

  test('a restore failure reply says where the copies are', () => {
    const text = replyText({ ...PROOF, verdict: 'restore-failed', detail: 'restore did not match for src/add.ts; your copies are in /tmp/t/prove-it-1000' })
    expect(text).toContain('/tmp/t/prove-it-1000')
  })
})
