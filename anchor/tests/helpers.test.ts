import { describe, expect, test } from 'claude-code/testing'

import { anchorPrefix, rewriteCommand, shellQuote } from '../hooks/shell'
import { isInside, normalizePath, parentOf, resolvePath, respeller } from '../hooks/paths'
import { gitWriteTarget } from '../hooks/guard'
import { readGitDirs } from '../hooks/git'
import { spriteRows } from '../hooks/sprite'
import { statusText } from '../hooks/describe'

describe('shell', () => {
  test('quotes a plain path', () => {
    expect(shellQuote('/repo/wt')).toBe(`'/repo/wt'`)
  })

  test('escapes single quotes in a path', () => {
    expect(shellQuote(`/it's here`)).toBe(`'/it'\\''s here'`)
  })

  test('prefixes a command with cd into the anchor', () => {
    expect(rewriteCommand('ls -la', '/repo/wt')).toBe(`cd '/repo/wt' && { ls -la\n}`)
  })

  test('groups the command so a & does not escape the cd', () => {
    expect(rewriteCommand('sleep 0 & pwd', '/repo/wt')).toBe(`cd '/repo/wt' && { sleep 0 & pwd\n}`)
  })

  test('a trailing comment cannot swallow the closing brace', () => {
    expect(rewriteCommand('ls # list', '/repo/wt')).toEndWith('# list\n}')
  })

  test('rewrites exactly once (idempotent)', () => {
    const once = rewriteCommand('git status', '/my repo/it\'s')
    expect(rewriteCommand(once, '/my repo/it\'s')).toBe(once)
    expect(once).toStartWith(anchorPrefix('/my repo/it\'s'))
  })

  test('a different cd is still prefixed', () => {
    expect(rewriteCommand(`cd '/elsewhere' && ls`, '/repo/wt')).toBe(
      `cd '/repo/wt' && { cd '/elsewhere' && ls\n}`,
    )
  })
})

describe('paths', () => {
  test('normalizes dots and trailing slashes', () => {
    expect(normalizePath('/a/b/../c/./d/')).toBe('/a/c/d')
    expect(normalizePath('/')).toBe('/')
    expect(normalizePath('/a//b')).toBe('/a/b')
  })

  test('resolves relative paths against a base', () => {
    expect(resolvePath('src/x.ts', '/repo/wt')).toBe('/repo/wt/src/x.ts')
    expect(resolvePath('../..', '/repo/.worktrees/x')).toBe('/repo')
    expect(resolvePath('/abs', '/repo')).toBe('/abs')
  })

  test('isInside respects path boundaries', () => {
    expect(isInside('/repo/wt/a.ts', '/repo/wt')).toBe(true)
    expect(isInside('/repo/wt', '/repo/wt')).toBe(true)
    expect(isInside('/repo/wt-other/a.ts', '/repo/wt')).toBe(false)
    expect(isInside('/repo', '/repo/wt')).toBe(false)
  })

  test('respeller maps resolved paths back through the symlink', () => {
    const respell = respeller('/private/tmp/r/.worktrees/x', '/tmp/r/.worktrees/x')
    expect(respell('/private/tmp/r')).toBe('/tmp/r')
    expect(respell('/private/tmp/r/.worktrees/x')).toBe('/tmp/r/.worktrees/x')
    expect(respell('/elsewhere/r')).toBe('/elsewhere/r')
  })

  test('respeller maps a symlinked worktree folder to its link', () => {
    const respell = respeller('/b/repo/.worktrees/wt', '/a/link-wt')
    expect(respell('/b/repo/.worktrees/wt')).toBe('/a/link-wt')
    expect(respell('/b/repo')).toBe('/b/repo')
  })

  test('respeller is the identity without a symlink', () => {
    expect(respeller('/repo/wt', '/repo/wt')('/repo')).toBe('/repo')
  })

  test('parentOf drops the last segment', () => {
    expect(parentOf('/repo/.git')).toBe('/repo')
    expect(parentOf('/repo/.git/')).toBe('/repo')
  })
})

describe('git', () => {
  test('a linked worktree records its primary checkout', () => {
    const dirs = readGitDirs(
      '/repo/.git/worktrees/wt\n/repo/.git\n/repo/.worktrees/wt\n',
      '/repo/.worktrees/wt',
    )
    expect(dirs).toEqual({ root: '/repo/.worktrees/wt', primary: '/repo' })
  })

  test('the primary checkout itself has no primary', () => {
    expect(readGitDirs('/repo/.git\n/repo/.git\n/repo\n', '/repo')).toEqual({
      root: '/repo',
      primary: null,
    })
  })

  test('relative git dirs resolve against the cwd', () => {
    expect(readGitDirs('.git\n.git\n/repo\n', '/repo')).toEqual({
      root: '/repo',
      primary: null,
    })
  })

  test('a bare common dir is not a checkout', () => {
    expect(
      readGitDirs('/srv/repo.git/worktrees/wt\n/srv/repo.git\n/srv/wt\n', '/srv/wt'),
    ).toEqual({ root: '/srv/wt', primary: null })
  })

  test('garbage output means no git info', () => {
    expect(readGitDirs('', '/x')).toEqual({ root: '/x', primary: null })
  })
})

describe('guard', () => {
  const primary = '/repo'
  const root = '/repo/.worktrees/wt'

  test('git -C <primary> commit is caught', () => {
    expect(gitWriteTarget(`git -C /repo commit -m x`, root, primary, root)).toEqual({
      verb: 'commit',
      dir: '/repo',
    })
  })

  test('cd <primary> && git checkout is caught', () => {
    expect(gitWriteTarget(`cd /repo && git checkout main`, root, primary, root)?.verb).toBe(
      'checkout',
    )
  })

  test('quoted primary paths with spaces are caught', () => {
    expect(
      gitWriteTarget(`cd '/my repo' ; git stash`, '/my repo/.worktrees/a b', '/my repo', '/my repo/.worktrees/a b')
        ?.verb,
    ).toBe('stash')
  })

  test('relative cd out of a nested worktree is caught', () => {
    expect(gitWriteTarget(`cd ../.. && git reset --hard`, root, primary, root)?.verb).toBe('reset')
  })

  test('every listed write verb is caught', () => {
    for (const verb of ['commit', 'checkout', 'switch', 'reset', 'stash', 'merge', 'rebase', 'push', 'restore']) {
      expect(gitWriteTarget(`git -C /repo ${verb}`, root, primary, root)?.verb).toBe(verb)
    }
    expect(gitWriteTarget(`git -C /repo branch -D old`, root, primary, root)?.verb).toBe('branch -D')
  })

  test('reads and plain branch listing pass', () => {
    expect(gitWriteTarget(`git -C /repo status`, root, primary, root)).toBeNull()
    expect(gitWriteTarget(`git -C /repo log --oneline`, root, primary, root)).toBeNull()
    expect(gitWriteTarget(`git -C /repo branch`, root, primary, root)).toBeNull()
    expect(gitWriteTarget(`git -C /repo branch new-one`, root, primary, root)).toBeNull()
  })

  test('writes inside the anchored worktree pass', () => {
    expect(gitWriteTarget(`git commit -m x`, root, primary, root)).toBeNull()
    expect(gitWriteTarget(`git -C ${root} push`, root, primary, root)).toBeNull()
    expect(gitWriteTarget(`cd /repo && cd .worktrees/wt && git commit`, root, primary, root)).toBeNull()
  })

  test('writes elsewhere entirely pass', () => {
    expect(gitWriteTarget(`git -C /other commit`, root, primary, root)).toBeNull()
  })

  test('the anchored rewrite (a { } group) is read through', () => {
    expect(gitWriteTarget(rewriteCommand('cd /repo && git commit', root), root, primary, root)?.verb).toBe(
      'commit',
    )
  })

  test('assignments and command/env/exec wrappers are skipped', () => {
    for (const command of [
      'cd /repo && FOO=1 git commit -m x',
      'cd /repo && command git commit -m x',
      'cd /repo && env -i A=1 git commit -m x',
      'cd /repo && exec git commit -m x',
      'cd /repo && /usr/bin/git commit -m x',
    ]) {
      expect(gitWriteTarget(rewriteCommand(command, root), root, primary, root)?.verb).toBe('commit')
    }
  })

  test('pushd and cd with -L/-P/-- are followed', () => {
    for (const command of ['pushd /repo && git commit', 'cd -P /repo && git commit', 'cd -- /repo && git commit']) {
      expect(gitWriteTarget(command, root, primary, root)?.verb).toBe('commit')
    }
  })

  test("a backgrounded cd does not carry past the &", () => {
    expect(gitWriteTarget('cd /repo & git commit', root, primary, root)).toBeNull()
    expect(gitWriteTarget(rewriteCommand('cd /repo & git commit', root), root, primary, root)).toBeNull()
    expect(gitWriteTarget('cd /repo && git commit &', root, primary, root)?.verb).toBe('commit')
  })

  test('redirections with & are not separators', () => {
    expect(gitWriteTarget('cd /repo 2>&1 && git commit >&2', root, primary, root)?.verb).toBe('commit')
  })

  test('either spelling of the primary is caught', () => {
    expect(
      gitWriteTarget('git -C /private/repo commit', root, [primary, '/private/repo'], [root, '/private/repo/.worktrees/wt'])
        ?.verb,
    ).toBe('commit')
  })

  test('global options before the verb are skipped', () => {
    expect(
      gitWriteTarget(`cd /repo && git -c user.name=x --no-pager commit`, root, primary, root)?.verb,
    ).toBe('commit')
  })
})

describe('sprite', () => {
  test('two pixel rows fold into one text row', () => {
    const rows = spriteRows(['ab', '.b'], { a: '#FF004D', b: '#29ADFF' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual([
      { text: '▀', color: '#FF004D' },
      { text: '█', color: '#29ADFF' },
    ])
  })

  test('bottom-only pixels draw a lower half block and blanks merge', () => {
    const rows = spriteRows(['...', '.aa'], { a: '#29ADFF' })
    expect(rows[0]).toEqual([
      { text: ' ' },
      { text: '▄▄', color: '#29ADFF' },
    ])
  })

  test('mixed top and bottom colours use a background', () => {
    const rows = spriteRows(['a', 'b'], { a: '#FFF1E8', b: '#1D2B53' })
    expect(rows[0]).toEqual([{ text: '▀', color: '#FFF1E8', backgroundColor: '#1D2B53' }])
  })

  test('an odd row count pads with transparency', () => {
    expect(spriteRows(['a'], { a: '#29ADFF' })[0]).toEqual([{ text: '▀', color: '#29ADFF' }])
  })
})

describe('status', () => {
  test('names the worktree and branch', () => {
    expect(statusText({ name: 'fix-login', branch: 'fix/login' })).toBe(
      '╋ ANCHOR fix-login@fix/login',
    )
  })

  test('omits a missing branch', () => {
    expect(statusText({ name: 'scratch', branch: null })).toBe('╋ ANCHOR scratch')
  })

  test('stays within 40 columns', () => {
    const text = statusText({ name: 'a-very-long-worktree-name', branch: 'feature/with-a-long-branch-name' })
    expect(text.length).toBeLessThanOrEqual(40)
    expect(text).toEndWith('…')
  })
})
