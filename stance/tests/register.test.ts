import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PRESENTATION = { isFullscreen: false, columns: 100 }
const COMPOSER = { kind: 'composer' } as const

/** The engine beneath the plugin: every tool call succeeds, toasts are kept. */
const world = (on: On) => {
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  const contexts: (readonly string[] | undefined)[] = []
  const toolInputs: Record<string, unknown>[] = []
  on('tool.call', ($, e) => {
    toolInputs.push(e as Record<string, unknown>)
    return { result: 'ok' } as never
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    contexts.push(e.context)
    return { text: e.text, context: e.context }
  })
  on('command.run', () => ({ text: 'engine' }))
  return { toasts, statuses, contexts, toolInputs }
}

const stanceCommand = ($: Engine, args: string) =>
  $.command.run({ command: 'stance', args, origin: COMPOSER, presentation: PRESENTATION })

const submit = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: COMPOSER })

const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })

const isDenied = (result: { isError?: true; deny?: string }) => result.isError === true || result.deny !== undefined

describe('stance matrix through the engine', () => {
  test('build is the default and restricts nothing', async ($, on) => {
    world(on)
    expect(isDenied(await edit($))).toBe(false)
    expect(isDenied(await bash($, 'git push'))).toBe(false)
    expect(isDenied(await $.tool.call({ tool: 'mcp__chat__send_message' } as never))).toBe(false)
  })

  test('investigate denies edits, git/gh writes and MCP writes; allows reads', async ($, on) => {
    world(on)
    await stanceCommand($, 'investigate')
    const denied = await edit($)
    expect(isDenied(denied)).toBe(true)
    expect(denied.text ?? denied.deny).toContain('INVESTIGATE')
    expect(denied.text ?? denied.deny).toContain('/stance')
    expect(isDenied(await $.tool.call({ tool: 'Write', file_path: '/tmp/notes.md', content: 'x' }))).toBe(false)
    expect(isDenied(await bash($, 'git commit -m x'))).toBe(true)
    expect(isDenied(await bash($, 'gh pr create --fill'))).toBe(true)
    expect(isDenied(await bash($, 'git status'))).toBe(false)
    expect(isDenied(await $.tool.call({ tool: 'mcp__tracker__save_issue' } as never))).toBe(true)
    expect(isDenied(await $.tool.call({ tool: 'mcp__tracker__get_issue' } as never))).toBe(false)
    expect(isDenied(await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' }))).toBe(false)
  })

  test('investigate allows writes under the session TMPDIR', async ($, on) => {
    world(on)
    mock.env(on, { TMPDIR: '/scratch/me/T/' })
    await stanceCommand($, 'investigate')
    expect(isDenied(await $.tool.call({ tool: 'Write', file_path: '/scratch/me/T/report.md', content: 'x' }))).toBe(false)
    expect(isDenied(await $.tool.call({ tool: 'Write', file_path: '/scratch/me/other.md', content: 'x' }))).toBe(true)
  })

  test('draft allows local work and denies sending', async ($, on) => {
    world(on)
    await stanceCommand($, 'draft')
    expect(isDenied(await edit($))).toBe(false)
    expect(isDenied(await bash($, 'git commit -m x'))).toBe(false)
    expect(isDenied(await bash($, 'git push'))).toBe(true)
    expect(isDenied(await bash($, 'gh pr merge 42'))).toBe(true)
    expect(isDenied(await $.tool.call({ tool: 'mcp__chat__post_message' } as never))).toBe(true)
  })

  test('draft denies gh sends and pushes hidden in subshells', async ($, on) => {
    world(on)
    await stanceCommand($, 'draft')
    for (const command of [
      '(cd /repo && git push)',
      'echo $(git push)',
      'git push&',
      'bash -c "git push"',
      'gh pr review 42 --approve',
      'gh issue comment 42 -b hi',
      'gh api -X POST repos/o/r/issues/42/comments -f body=hi',
    ]) {
      expect(isDenied(await bash($, command)), command).toBe(true)
    }
  })

  test('ship restricts nothing', async ($, on) => {
    world(on)
    await stanceCommand($, 'ship')
    expect(isDenied(await edit($))).toBe(false)
    expect(isDenied(await bash($, 'git push && gh pr merge 42'))).toBe(false)
  })
})

describe('/stance', () => {
  test('shows the current stance, switches, rejects unknown names', async ($, on) => {
    const { statuses } = world(on)
    expect((await stanceCommand($, '')).text).toContain('BUILD')
    const switched = await stanceCommand($, 'inv')
    expect(switched.text).toContain('INVESTIGATE')
    expect((await stanceCommand($, '')).text).toContain('INVESTIGATE')
    expect(statuses.at(-1)).toContain('INVESTIGATE')
    const unknown = await stanceCommand($, 'yolo')
    expect(unknown.text).toContain('investigate')
    expect((await stanceCommand($, '')).text).toContain('INVESTIGATE')
    await stanceCommand($, 'build')
    expect(statuses.at(-1)).toBeUndefined()
  })
})

describe('/stance names who set it', () => {
  test('default, auto-detected, set by you', async ($, on) => {
    world(on)
    expect((await stanceCommand($, '')).text).toContain('BUILD (default)')
    await submit($, 'no code please, just look')
    const auto = (await stanceCommand($, '')).text
    expect(auto).toContain('INVESTIGATE (auto-detected)')
    expect(auto).not.toContain('(default)')
    await stanceCommand($, 'draft')
    expect((await stanceCommand($, '')).text).toContain('DRAFT (set by you)')
  })
})

describe('auto-detect', () => {
  test('phrases switch the stance and toast', async ($, on) => {
    const { toasts } = world(on)
    await submit($, 'Investigation only: why does the cache miss? No code.')
    expect(toasts).toContain('STANCE → INVESTIGATE')
    expect(isDenied(await edit($))).toBe(true)
  })

  test('draft phrase', async ($, on) => {
    const { toasts } = world(on)
    await submit($, 'Write the release note but do not post it')
    expect(toasts).toContain('STANCE → DRAFT')
    expect(isDenied(await bash($, 'git push'))).toBe(true)
    expect(isDenied(await edit($))).toBe(false)
  })

  test('never loosens a stance the user set, and says so', async ($, on) => {
    const { toasts } = world(on)
    await stanceCommand($, 'investigate')
    await submit($, 'draft only')
    expect(toasts.some(text => text.includes('KEPT'))).toBe(true)
    expect(isDenied(await edit($))).toBe(true)
  })

  test('an auto-tightened stance is not reported as set by you', async ($, on) => {
    const { toasts } = world(on)
    await stanceCommand($, 'build')
    await submit($, 'findings only')
    await submit($, 'draft only')
    expect(toasts).toEqual(['STANCE → INVESTIGATE', 'STANCE → DRAFT'])
    expect(toasts.some(text => text.includes('KEPT'))).toBe(false)
  })

  test('the kept toast names the stance the person chose', async ($, on) => {
    const { toasts } = world(on)
    await stanceCommand($, 'investigate')
    await submit($, 'draft only')
    expect(toasts).toEqual(['STANCE KEPT: INVESTIGATE (SET BY YOU)'])
  })

  test('only the person’s own prompts switch it', async ($, on) => {
    world(on)
    await $.prompt.submit({ text: 'no code', wait: false, origin: { kind: 'peer' } })
    expect(isDenied(await edit($))).toBe(false)
  })

  test('autoDetect off leaves the stance alone', { options: { autoDetect: false } }, async ($, on) => {
    const { toasts } = world(on)
    await submit($, 'no code, findings only')
    expect(toasts).toHaveLength(0)
    expect(isDenied(await edit($))).toBe(false)
  })
})

describe('telling the model', () => {
  test('each prompt carries the stance outside build', async ($, on) => {
    const { contexts } = world(on)
    await submit($, 'hello')
    expect(contexts.at(-1) ?? []).toHaveLength(0)
    await stanceCommand($, 'draft')
    await submit($, 'hello again')
    const context = (contexts.at(-1) ?? []).join('\n')
    expect(context).toContain('DRAFT')
    expect(context).toContain('git push')
  })

  test('the command answer tells the model too', async ($, on) => {
    world(on)
    const answer = await stanceCommand($, 'investigate')
    expect((answer.context ?? []).join('\n')).toContain('INVESTIGATE')
  })
})

describe('subagents', () => {
  test('a subagent’s tool calls obey the stance', async ($, on) => {
    world(on)
    await stanceCommand($, 'investigate')
    const call = { tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b', agentId: 'agent-1' }
    expect(isDenied(await $.tool.call(call as never))).toBe(true)
    expect(isDenied(await $.tool.call({ tool: 'Bash', command: 'git push', agentId: 'agent-1' } as never))).toBe(true)
  })

  test('a spawned subagent is told the stance in its prompt', async ($, on) => {
    const { toolInputs } = world(on)
    await stanceCommand($, 'investigate')
    await $.tool.call({ tool: 'Agent', description: 'look', prompt: 'Find the bug.' })
    const sent = toolInputs.find(input => input.tool === 'Agent')
    expect(String(sent?.prompt)).toContain('INVESTIGATE')
    expect(String(sent?.prompt)).toContain('Find the bug.')
  })

  test('in build the subagent prompt is untouched', async ($, on) => {
    const { toolInputs } = world(on)
    await $.tool.call({ tool: 'Agent', description: 'look', prompt: 'Find the bug.' })
    expect(toolInputs.find(input => input.tool === 'Agent')?.prompt).toBe('Find the bug.')
  })
})
