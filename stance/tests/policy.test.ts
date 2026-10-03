import { describe, expect, test } from 'claude-code/testing'
import { checkToolCall, commandsIn, isTempPath, shellCommands } from '../hooks/policy'
import type { Stance } from '../hooks/stances'

const TEMP = { tempRoots: ['/var/folders/xy/T/'] }

const denied = (stance: Stance, call: Record<string, unknown>) =>
  checkToolCall(stance, call as { tool: string }, TEMP) !== undefined

const bash = (command: string) => ({ tool: 'Bash', command })

describe('investigate', () => {
  test('denies edits outside temp, allows temp and scratchpad', () => {
    expect(denied('investigate', { tool: 'Edit', file_path: '/repo/src/a.ts' })).toBe(true)
    expect(denied('investigate', { tool: 'Write', file_path: 'notes.md' })).toBe(true)
    expect(denied('investigate', { tool: 'NotebookEdit', notebook_path: '/repo/a.ipynb' })).toBe(true)
    expect(denied('investigate', { tool: 'Write', file_path: '/tmp/out.txt' })).toBe(false)
    expect(denied('investigate', { tool: 'Write', file_path: '/private/tmp/x/out.txt' })).toBe(false)
    expect(denied('investigate', { tool: 'Write', file_path: '/var/folders/xy/T/out.txt' })).toBe(false)
    expect(denied('investigate', { tool: 'Edit', file_path: '/home/me/.cache/session/scratchpad/n.md' })).toBe(false)
    expect(denied('investigate', { tool: 'Write', file_path: '/tmp/../repo/src/a.ts' })).toBe(true)
  })

  test('denies git writes', () => {
    for (const command of [
      'git commit -m "x"',
      'git push origin HEAD',
      'git branch feature/x',
      'git branch -D old',
      'git switch -c feat',
      'git checkout -b feat',
      'git worktree add ../wt',
      'git merge main',
      'git rebase main',
      'cd /repo && git commit -am wip',
      'git -C /repo push',
      'FOO=1 git commit -m x',
    ]) {
      expect(denied('investigate', bash(command)), command).toBe(true)
    }
  })

  test('allows git reads', () => {
    for (const command of [
      'git status',
      'git log --oneline -5',
      'git diff main...HEAD',
      'git branch',
      'git branch -a',
      'git branch --show-current',
      'git switch main',
      'git checkout main -- file.ts',
      'git worktree list',
      'git show HEAD',
      'echo "git commit" ',
    ]) {
      expect(denied('investigate', bash(command)), command).toBe(false)
    }
  })

  test('denies git writes hidden in subshells, wrappers, substitutions and attached flags', () => {
    for (const command of [
      '(cd /repo && git commit -m x)',
      '{ git commit -m x; }',
      'bash -c "git commit -m x"',
      'echo $(git commit -m x)',
      'echo `git commit -m x`',
      'echo "$(git commit -m x)"',
      'xargs git commit -m x',
      'nice -n 5 git commit -m x',
      '/usr/bin/git commit -m x',
      'git checkout -bfoo',
      'git checkout -qb foo',
      'git switch -cfoo',
      'git branch -Dold',
      'git commit -m x &',
      'eval "git commit -m x"',
    ]) {
      expect(denied('investigate', bash(command)), command).toBe(true)
    }
  })

  test('denies gh writes, allows gh reads', () => {
    for (const command of [
      'gh pr create --fill',
      'gh pr merge 42',
      'gh pr comment 42 -b hi',
      'gh pr review 42 --approve',
      'gh issue create -t x',
      'gh issue comment 42 -b hi',
      'gh pr checkout 42',
      'gh api -X POST repos/o/r/issues/42/comments -f body=hi',
    ]) {
      expect(denied('investigate', bash(command)), command).toBe(true)
    }
    for (const command of [
      'gh pr view 42',
      'gh pr checks 42',
      'gh issue list',
      'gh run list',
      'gh api repos/o/r/pulls/42',
      'gh api -X GET repos/o/r/issues -f state=open',
      "gh api graphql -f query='query { viewer { login } }'",
    ]) {
      expect(denied('investigate', bash(command)), command).toBe(false)
    }
  })

  test('denies MCP write-verb tools, allows MCP reads', () => {
    expect(denied('investigate', { tool: 'mcp__chat__send_message' })).toBe(true)
    expect(denied('investigate', { tool: 'mcp__tracker__save_issue' })).toBe(true)
    expect(denied('investigate', { tool: 'mcp__tracker__create_comment' })).toBe(true)
    expect(denied('investigate', { tool: 'mcp__docs__update-page' })).toBe(true)
    expect(denied('investigate', { tool: 'mcp__tracker__get_issue' })).toBe(false)
    expect(denied('investigate', { tool: 'mcp__chat__search_public' })).toBe(false)
  })

  test('allows reads', () => {
    expect(denied('investigate', { tool: 'Read', file_path: '/repo/a.ts' })).toBe(false)
    expect(denied('investigate', { tool: 'Grep', pattern: 'x' })).toBe(false)
    expect(denied('investigate', bash('ls -la'))).toBe(false)
  })

  test('deny text names the stance and how to switch', () => {
    const verdict = checkToolCall('investigate', { tool: 'Edit', file_path: '/repo/a.ts' } as { tool: string }, TEMP)
    expect(verdict).toContain('INVESTIGATE')
    expect(verdict).toContain('/stance build')
  })
})

describe('draft', () => {
  test('allows local work', () => {
    expect(denied('draft', { tool: 'Edit', file_path: '/repo/a.ts' })).toBe(false)
    for (const command of ['git commit -m x', 'git checkout -b feat', 'git rebase main', 'gh pr view 42', 'gh pr checkout 42', 'gh api repos/o/r/pulls']) {
      expect(denied('draft', bash(command)), command).toBe(false)
    }
  })

  test('denies sending', () => {
    for (const command of [
      'git push',
      'git push -u origin feat',
      'gh pr create',
      'gh pr merge 42',
      'gh pr comment 42 -b x',
      'gh pr review 42 --approve',
      'gh pr edit 42 --add-label x',
      'gh issue create -t x',
      'gh issue comment 42 -b hi',
      'gh issue close 42',
      'gh release create v1',
      'gh api -X POST repos/o/r/issues/42/comments -f body=hi',
      'gh api --method=PATCH repos/o/r/issues/42',
      'gh api repos/o/r/issues/42/comments -f body=hi',
      "gh api graphql -f query='mutation { addStar }'",
    ]) {
      expect(denied('draft', bash(command)), command).toBe(true)
    }
    expect(denied('draft', { tool: 'mcp__chat__post_message' })).toBe(true)
    expect(denied('draft', { tool: 'mcp__mail__reply' })).toBe(true)
    expect(denied('draft', { tool: 'mcp__mail__list_drafts' })).toBe(false)
  })

  test('deny text names the stance and how to switch', () => {
    const verdict = checkToolCall('draft', bash('git push') as { tool: string }, TEMP)
    expect(verdict).toContain('DRAFT')
    expect(verdict).toContain('/stance')
  })
})

describe('evasion forms', () => {
  test('draft denies pushes behind subshells, wrappers, substitutions and background jobs', () => {
    for (const command of [
      '(git push)',
      '(cd /repo && git push)',
      'bash -c "git push"',
      "sh -lc 'git push origin HEAD'",
      'zsh -c "cd /repo; git push"',
      'echo $(git push)',
      'echo `git push`',
      'xargs git push',
      'find . | xargs -I {} git push',
      '/usr/bin/git push',
      'nice git push',
      'sudo -u me git push',
      'timeout 30 git push',
      'env FOO=1 git push',
      'git push&',
      'git push 2>&1',
      'eval git push',
      'bash -c "gh pr create --fill"',
    ]) {
      expect(denied('draft', bash(command)), command).toBe(true)
    }
  })

  test('quoted text is not a command', () => {
    for (const command of ['echo "git push"', "grep -r 'git push' docs", 'git log --grep="(push)"', 'git commit -m "fix (push) path"']) {
      expect(denied('draft', bash(command)), command).toBe(false)
    }
  })
})

describe('build and ship', () => {
  test('allow everything', () => {
    for (const stance of ['build', 'ship'] as const) {
      expect(denied(stance, { tool: 'Edit', file_path: '/repo/a.ts' })).toBe(false)
      expect(denied(stance, bash('git push && gh pr merge 42'))).toBe(false)
      expect(denied(stance, { tool: 'mcp__chat__send_message' })).toBe(false)
    }
  })
})

describe('helpers', () => {
  test('shellCommands splits on shell operators and keeps quoted words whole', () => {
    expect(shellCommands('a && b || c; d | e\nf & g')).toEqual([['a'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g']])
    expect(shellCommands('(cd x && git push)')).toEqual([['cd', 'x'], ['git', 'push']])
    expect(shellCommands('echo "a; b" \'c|d\'')).toEqual([['echo', 'a; b', 'c|d']])
  })

  test('commandsIn unwraps wrappers, shells and paths', () => {
    expect(commandsIn('FOO=1 nice -n 5 /usr/bin/git push')).toEqual([['git', 'push']])
    expect(commandsIn('bash -c "git status && git push"')).toEqual([['git', 'status'], ['git', 'push']])
  })

  test('isTempPath', () => {
    expect(isTempPath('/tmp/a', [])).toBe(true)
    expect(isTempPath('/tmpfoo/a', [])).toBe(false)
    expect(isTempPath('relative/a', [])).toBe(false)
  })
})
