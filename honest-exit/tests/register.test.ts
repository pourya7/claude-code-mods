import { describe, expect, test } from 'claude-code/testing'

import { START, run, world } from './world'

const contextOf = (ran: unknown): readonly string[] => (ran as { context?: readonly string[] }).context ?? []

describe('catching quiet failures after a Bash result', () => {
  test('a glob that matched nothing gets a model note, a toast and the status counter', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answer = { kind: 'error', text: 'Exit code 1\nzsh: no matches found: *.tsx' }
    const ran = await $.tool.call({ tool: 'Bash', command: 'wc -l *.tsx' })
    expect(ran.isError).toBe(true)
    expect(contextOf(ran).join('\n')).toContain("the glob didn't match, so the command that contained it never ran")
    expect(w.toasts).toEqual(['HONEST EXIT ▸ GLOB MATCHED NOTHING: *.tsx'])
    expect(w.statuses.at(-1)).toBe('EXIT ▸ 1 CAUGHT')
  })

  test('a missing alias-prone command is noted', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answer = { kind: 'error', text: 'Exit code 127\nzsh: command not found: ll' }
    const ran = await $.tool.call({ tool: 'Bash', command: 'll src' })
    expect(contextOf(ran).join('\n')).toContain('agent shells may differ')
    expect(w.toasts[0]).toBe('HONEST EXIT ▸ NOT IN THIS SHELL: ll')
  })

  test('exit 0 with failure output behind a pipe is noted', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answer = { kind: 'ok', stdout: '  2 failing\n' }
    const ran = await $.tool.call({ tool: 'Bash', command: 'npm test 2>&1 | tail -5' })
    expect(ran.isError).toBeUndefined()
    expect(contextOf(ran).join('\n')).toContain('the pipeline hid the exit status of the first command')
    expect(w.toasts[0]).toBe('HONEST EXIT ▸ PIPE HID A FAILURE: 2 failing')
  })

  test('failure words in stderr count too', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answer = { kind: 'ok', stdout: '', stderr: 'Error: boom' }
    const ran = await $.tool.call({ tool: 'Bash', command: 'npm run build || true' })
    expect(contextOf(ran)).toHaveLength(1)
  })

  test('a shell error line inside a successful call\'s stdout is file content, not a catch', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answer = { kind: 'ok', stdout: 'zsh: command not found: cp\nnotes/a.md:1:no matches found: *.x' }
    const ran = await $.tool.call({ tool: 'Bash', command: 'cat build.log notes/a.md' })
    expect(contextOf(ran)).toEqual([])
    expect(w.toasts).toEqual([])
  })

  test('a glob that failed mid-line on stderr of a call that exited 0 is still caught', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answer = { kind: 'ok', stdout: 'a\nb', stderr: '(eval):1: no matches found: *.nope' }
    const ran = await $.tool.call({ tool: 'Bash', command: 'echo a; ls *.nope; echo b' })
    expect(contextOf(ran).join('\n')).toContain('may still have run')
    expect(w.toasts).toEqual(['HONEST EXIT ▸ GLOB MATCHED NOTHING: *.nope'])
  })

  test('a clean result passes through untouched, with no note, toast or status', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answer = { kind: 'ok', stdout: 'a.ts\nb.ts' }
    const ran = await $.tool.call({ tool: 'Bash', command: 'ls | head' })
    expect(contextOf(ran)).toEqual([])
    expect(w.toasts).toEqual([])
    expect(w.statuses.filter(text => text !== undefined)).toEqual([])
  })

  test('an honest failing exit is not noted', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answer = { kind: 'error', text: 'Exit code 1\n1 failing' }
    const ran = await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(contextOf(ran)).toEqual([])
    expect(w.toasts).toEqual([])
  })

  test('subagent calls are caught too', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answer = { kind: 'error', text: 'zsh: no matches found: *.md' }
    const ran = await $.tool.call({ tool: 'Bash', command: 'cat *.md', agentId: 'helper-1' } as never)
    expect(contextOf(ran).join('\n')).toContain('*.md')
    expect(w.toasts).toHaveLength(1)
    const reply = await $.command.run(run())
    expect(reply.text).toContain('SUBAGENT')
  })

  test('a denied call, a backgrounded call and other tools are left alone', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answer = { kind: 'deny', reason: 'no' }
    expect((await $.tool.call({ tool: 'Bash', command: 'ls *.x' })).deny).toBe('no')
    w.answer = { kind: 'ok', stdout: 'FAILED', backgroundTaskId: 'bg1' }
    expect(contextOf(await $.tool.call({ tool: 'Bash', command: 'pytest | tail' }))).toEqual([])
    w.answer = { kind: 'ok', stdout: 'FAILED' }
    expect(contextOf(await $.tool.call({ tool: 'Read', file_path: '/work/app/x.log' } as never))).toEqual([])
    expect(w.toasts).toEqual([])
  })

  test('the counter adds up across calls', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answer = { kind: 'error', text: 'zsh: no matches found: *.a' }
    await $.tool.call({ tool: 'Bash', command: 'ls *.a' })
    await $.tool.call({ tool: 'Bash', command: 'ls *.a' })
    w.answer = { kind: 'ok', stdout: 'Traceback (most recent call last):' }
    await $.tool.call({ tool: 'Bash', command: 'python x.py | tee out.log' })
    expect(w.statuses.at(-1)).toBe('EXIT ▸ 3 CAUGHT')
  })
})

describe('rewrites', () => {
  test('are off by default: the command runs exactly as given', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answer = { kind: 'ok', stdout: '' }
    const ran = await $.tool.call({ tool: 'Bash', command: 'grep -r --include=*.ts foo . && jest | tail' })
    expect(w.ran[0]?.command).toBe('grep -r --include=*.ts foo . && jest | tail')
    expect(contextOf(ran)).toEqual([])
  })

  test('when on, quote flag globs and add pipefail, and tell the model', { options: { rewrite: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answer = { kind: 'ok', stdout: '' }
    const ran = await $.tool.call({ tool: 'Bash', command: 'grep -r --include=*.ts foo . && jest | tail' })
    expect(w.ran[0]?.command).toBe("set -o pipefail; grep -r --include='*.ts' foo . && jest | tail")
    const note = contextOf(ran).join('\n')
    expect(note).toContain('honest-exit rewrote')
    expect(note).toContain("set -o pipefail; grep -r --include='*.ts' foo . && jest | tail")
  })

  test('when on, a command already rewritten runs unchanged with no note', { options: { rewrite: true } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answer = { kind: 'ok', stdout: '' }
    const command = "set -o pipefail; grep -r --include='*.ts' foo . && jest | tail"
    const ran = await $.tool.call({ tool: 'Bash', command })
    expect(w.ran[0]?.command).toBe(command)
    expect(contextOf(ran)).toEqual([])
  })
})

describe('/honest-exit', () => {
  test('session.start registers the command', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.commands).toEqual(['honest-exit'])
  })

  test('replies with the count and recent catches and opens the pane', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answer = { kind: 'error', text: 'zsh: no matches found: *.log' }
    await $.tool.call({ tool: 'Bash', command: 'rm *.log' })
    const reply = await $.command.run(run())
    expect(reply.text).toContain('1 CAUGHT')
    expect(reply.text).toContain('GLOB')
    expect(reply.text).toContain('rm *.log')
    expect(w.opened.at(-1)?.id).toBe('honest-exit')
  })

  test('with nothing caught it says so', async ($, on) => {
    world(on)
    await $.session.start(START)
    const reply = await $.command.run(run())
    expect(reply.text).toContain('0 CAUGHT')
    expect(reply.text).toContain('rewrites OFF')
  })

  test('/honest-exit clear resets the count and clears the status', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.answer = { kind: 'error', text: 'zsh: no matches found: *.log' }
    await $.tool.call({ tool: 'Bash', command: 'rm *.log' })
    const reply = await $.command.run(run('clear'))
    expect(reply.text).toContain('0 CAUGHT')
    expect(w.statuses.at(-1)).toBeUndefined()
  })
})
