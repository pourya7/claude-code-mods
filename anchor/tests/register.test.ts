import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

const PRIMARY = '/work/my repo'
const WORKTREE = `/work/my repo/.worktrees/it's here`
const PLAIN = '/work/plain'
/** A worktree reached through a symlink: the session says /tmp, git says /private/tmp. */
const LINKED_PRIMARY = '/tmp/linked'
const LINKED = '/tmp/linked/.worktrees/wt'
const REAL_PRIMARY = '/private/tmp/linked'
const REAL_LINKED = '/private/tmp/linked/.worktrees/wt'

type World = {
  commands: string[]
  edits: string[]
  statuses: (string | undefined)[]
  toasts: string[]
  registered: string[]
}

/** Answers everything beneath the plugin: git, the filesystem, the tools, the UI lines. */
const world = (on: On, { isGitBroken = false } = {}): World => {
  const seen: World = { commands: [], edits: [], statuses: [], toasts: [], registered: [] }

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    seen.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.cwd', () => ({ value: WORKTREE }))
  on('ui.status', (_$, e) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.stat', (_$, e) => {
    if (e.path === PLAIN || e.path === WORKTREE || e.path === PRIMARY) {
      return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    }
    throw new Error('ENOENT')
  })
  on('process.run', (_$, e) => {
    if (isGitBroken) throw new Error('git: command not found')
    const cwd = e.init?.cwd ?? ''
    const ok = (stdout: string) => ({
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    const failed = {
      value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false },
    }
    const isBranch = e.argv[1] === 'branch'
    if (e.argv[0] === 'pwd') return ok(`${cwd === LINKED ? REAL_LINKED : cwd}\n`)
    if (cwd === LINKED) {
      return isBranch
        ? ok('feat/linked\n')
        : ok(`${REAL_PRIMARY}/.git/worktrees/wt\n${REAL_PRIMARY}/.git\n${REAL_LINKED}\n`)
    }
    if (cwd === WORKTREE) {
      return isBranch
        ? ok('fix/login\n')
        : ok(`${PRIMARY}/.git/worktrees/wt\n${PRIMARY}/.git\n${WORKTREE}\n`)
    }
    if (cwd === PRIMARY) {
      return isBranch ? ok('main\n') : ok(`${PRIMARY}/.git\n${PRIMARY}/.git\n${PRIMARY}\n`)
    }
    return failed
  })
  let spawned = 0
  on('agent.spawn', () => {
    spawned += 1
    return { model: 'test-model', agentId: `sub-${spawned}` }
  })
  on('tool.call', (_$, e) => {
    if (e.tool === 'Bash') seen.commands.push(e.command)
    if (e.tool === 'Edit' || e.tool === 'Write') seen.edits.push(e.file_path)
    if (e.tool === 'NotebookEdit') seen.edits.push(e.notebook_path)
    return { result: 'ok' }
  })

  return seen
}

/** An Agent tool's spawn as the engine raises it. */
const spawnOf = (fields: { tool_use_id: string; cwd?: string; parentAgentId?: string }) => ({
  prompt: 'do the thing',
  description: 'thing',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'test-model',
  background: false,
  fork: false,
  ...fields,
}) as never

const quoted = `'/work/my repo/.worktrees/it'\\''s here'`

/** What a command becomes once anchored in `dir` (already quoted). */
const anchored = (command: string, dir = quoted) => `cd ${dir} && { ${command}\n}`

describe('anchor setting', () => {
  test('session.start anchors to the cwd, records the primary and shows the status line', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })

    expect(seen.registered).toContain('anchor')
    expect(seen.statuses.at(-1)).toBe(`╋ ANCHOR it's here@fix/login`)
    const shown = await $.command.run({ command: 'anchor', args: '' })
    expect(shown.text).toContain(`ANCHOR SET  it's here@fix/login`)
    expect(shown.text).toContain(`ANCHOR  ${WORKTREE}`)
    expect(shown.text).toContain(`PRIMARY ${PRIMARY}`)
  })

  test('outside git the anchor still pins Bash, with no primary', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: PLAIN, surface: null, isInteractive: false })
    const shown = await $.command.run({ command: 'anchor', args: '' })
    expect(shown.text).not.toContain('PRIMARY')

    await $.tool.call({ tool: 'Bash', command: 'pwd' })
    expect(seen.commands).toEqual([anchored('pwd', `'/work/plain'`)])
  })

  test('/anchor shows the anchor and the paths', async ($, on) => {
    world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    const shown = await $.command.run({ command: 'anchor', args: '' })

    expect(shown.text).toContain('ANCHOR SET')
    expect(shown.text).toContain(`ANCHOR  ${WORKTREE}`)
    expect(shown.text).toContain(`PRIMARY ${PRIMARY}  GUARDED`)
  })

  test('/anchor <path> re-anchors and Bash follows', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    const moved = await $.command.run({ command: 'anchor', args: PLAIN })

    expect(moved.text).toContain(`ANCHOR  ${PLAIN}`)
    expect(seen.statuses.at(-1)).toBe('╋ ANCHOR plain')
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(seen.commands).toEqual([anchored('ls', `'/work/plain'`)])
  })

  test('/anchor <relative path> resolves against the anchor', async ($, on) => {
    world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    const moved = await $.command.run({ command: 'anchor', args: '../..' })

    expect(moved.text).toContain(`ANCHOR  ${PRIMARY}`)
  })

  test('/anchor <missing path> keeps the anchor', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    const missed = await $.command.run({ command: 'anchor', args: '/nope' })

    expect(missed.text).toContain('no such directory /nope')
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(seen.commands).toEqual([anchored('ls')])
  })

  test('/anchor off disables and /anchor on restores', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })

    const off = await $.command.run({ command: 'anchor', args: 'off' })
    expect(off.text).toContain('ANCHOR OFF')
    expect(seen.statuses.at(-1)).toBeUndefined()

    const back = await $.command.run({ command: 'anchor', args: 'on' })
    expect(back.text).toContain('ANCHOR SET')
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(seen.commands).toEqual([anchored('ls')])
  })
})

describe('a later session.start (enable, respawn, reload)', () => {
  test('keeps /anchor off: the session stays a pass-through', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    await $.command.run({ command: 'anchor', args: 'off' })
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })

    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(seen.commands).toEqual(['ls'])
    expect(seen.statuses.at(-1)).toBeUndefined()
  })

  test('keeps an anchor moved by /anchor <path>', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    await $.command.run({ command: 'anchor', args: PLAIN })
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })

    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(seen.commands).toEqual([anchored('ls', `'/work/plain'`)])
    expect(seen.statuses.at(-1)).toBe('╋ ANCHOR plain')
    expect(seen.registered).toEqual(['anchor', 'anchor'])
  })
})

describe('bash rewrite', () => {
  test('every Bash call is prefixed with a cd into the anchor, quotes escaped', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    await $.tool.call({ tool: 'Bash', command: 'git status' })

    expect(seen.commands).toEqual([anchored('git status')])
  })

  test('rewrite happens exactly once (idempotent)', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    await $.tool.call({ tool: 'Bash', command: `cd ${quoted} && make test` })

    expect(seen.commands).toEqual([`cd ${quoted} && make test`])
  })

  test('a rewritten command passed through another hook is not prefixed twice', async ($, on) => {
    const seen = world(on)
    // A second plugin that re-dispatches the same call beneath anchor would see the prefix already there.
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    await $.tool.call({ tool: 'Bash', command: 'echo one' })
    await $.tool.call({ tool: 'Bash', command: seen.commands[0] as string })

    expect(seen.commands[1]).toBe(seen.commands[0])
  })

  test('a backgrounded job still runs in the anchor', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    await $.tool.call({ tool: 'Bash', command: 'pnpm dev & sleep 3; curl localhost:3000' })

    expect(seen.commands).toEqual([`cd ${quoted} && { pnpm dev & sleep 3; curl localhost:3000\n}`])
  })

  test("subagents sharing the session's directory are rewritten too", async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    await $.tool.call({ tool: 'Bash', command: 'pwd', agentId: 'sub-1' } as never)

    expect(seen.commands).toEqual([anchored('pwd')])
  })

  test('off means a pure pass-through', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    await $.command.run({ command: 'anchor', args: 'off' })

    await $.tool.call({ tool: 'Bash', command: `cd '${PRIMARY}' && git commit -m x` })
    await $.tool.call({ tool: 'Edit', file_path: `${PRIMARY}/README.md`, old_string: 'a', new_string: 'b' })

    expect(seen.commands).toEqual([`cd '${PRIMARY}' && git commit -m x`])
    expect(seen.edits).toEqual([`${PRIMARY}/README.md`])
    expect(seen.toasts).toEqual([])
  })
})

describe('subagents with a directory of their own', () => {
  test('a subagent spawned with its own cwd is anchored there, not in the parent anchor', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    const { agentId } = await $.agent.spawn(spawnOf({ tool_use_id: 'tu-1', cwd: PLAIN }))

    await $.tool.call({ tool: 'Bash', command: 'pwd', agentId } as never)
    await $.tool.call({ tool: 'Bash', command: 'pwd' })
    expect(seen.commands).toEqual([anchored('pwd', `'/work/plain'`), anchored('pwd')])
  })

  test('a worktree-isolated subagent passes through: no cd, no guard', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    await $.tool.call({ tool: 'Agent', description: 'thing', prompt: 'do', isolation: 'worktree', tool_use_id: 'tu-2' })
    const { agentId } = await $.agent.spawn(spawnOf({ tool_use_id: 'tu-2' }))

    await $.tool.call({ tool: 'Bash', command: 'git commit -am wip', agentId } as never)
    expect(seen.commands).toEqual(['git commit -am wip'])
  })

  test("an isolated subagent's own subagent is isolated too", async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    await $.tool.call({ tool: 'Agent', description: 'thing', prompt: 'do', isolation: 'worktree', tool_use_id: 'tu-3' })
    const parent = await $.agent.spawn(spawnOf({ tool_use_id: 'tu-3' }))
    const child = await $.agent.spawn(spawnOf({ tool_use_id: 'tu-4', parentAgentId: parent.agentId }))

    await $.tool.call({ tool: 'Bash', command: 'make', agentId: child.agentId } as never)
    expect(seen.commands).toEqual(['make'])
  })

  test('a plain subagent spawn keeps the parent anchor', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    const { agentId } = await $.agent.spawn(spawnOf({ tool_use_id: 'tu-5' }))

    await $.tool.call({ tool: 'Bash', command: 'make', agentId } as never)
    expect(seen.commands).toEqual([anchored('make')])
  })
})

describe('primary-checkout guard', () => {
  test('Edit, Write and NotebookEdit in the primary are denied with a toast', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })

    const edit = await $.tool.call({ tool: 'Edit', file_path: `${PRIMARY}/src/a.ts`, old_string: 'a', new_string: 'b' })
    const write = await $.tool.call({ tool: 'Write', file_path: `${PRIMARY}/new.ts`, content: 'x' })
    const notebook = await $.tool.call({ tool: 'NotebookEdit', notebook_path: `${PRIMARY}/n.ipynb`, new_source: 'x' })

    for (const result of [edit, write, notebook]) {
      expect(result.deny).toContain(WORKTREE)
      expect(result.deny).toContain('/anchor off')
    }
    expect(seen.edits).toEqual([])
    expect(seen.toasts).toHaveLength(3)
    expect(seen.toasts[0]).toContain('ANCHOR BLOCKED EDIT')
  })

  test('edits inside the anchor nested under the primary are never denied', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })

    await $.tool.call({ tool: 'Edit', file_path: `${WORKTREE}/src/a.ts`, old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Write', file_path: 'relative/b.ts', content: 'x' })
    await $.tool.call({ tool: 'NotebookEdit', notebook_path: `${WORKTREE}/n.ipynb`, new_source: 'x' })

    expect(seen.edits).toEqual([`${WORKTREE}/src/a.ts`, 'relative/b.ts', `${WORKTREE}/n.ipynb`])
    expect(seen.toasts).toEqual([])
  })

  test('edits outside the primary checkout pass', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })
    await $.tool.call({ tool: 'Write', file_path: '/tmp/scratch.txt', content: 'x' })

    expect(seen.edits).toEqual(['/tmp/scratch.txt'])
  })

  test('git writes against the primary via cd or -C are denied', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })

    const viaCd = await $.tool.call({ tool: 'Bash', command: `cd '${PRIMARY}' && git commit -m wip` })
    const viaC = await $.tool.call({ tool: 'Bash', command: `git -C "${PRIMARY}" branch -D old` })

    expect(viaCd.deny).toContain('git commit')
    expect(viaCd.deny).toContain('/anchor off')
    expect(viaC.deny).toContain('git branch -D')
    expect(seen.commands).toEqual([])
    expect(seen.toasts[0]).toContain('ANCHOR BLOCKED GIT COMMIT')
  })

  test('git reads against the primary and writes in the anchor pass', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })

    await $.tool.call({ tool: 'Bash', command: `git -C '${PRIMARY}' log --oneline` })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m done' })

    expect(seen.commands).toEqual([
      anchored(`git -C '${PRIMARY}' log --oneline`),
      anchored('git commit -m done'),
    ])
  })

  test('protectPrimary off lifts the guard but keeps the rewrite', { options: { protectPrimary: false } }, async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })

    await $.tool.call({ tool: 'Edit', file_path: `${PRIMARY}/a.ts`, old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Bash', command: `git -C '${PRIMARY}' push` })

    expect(seen.edits).toEqual([`${PRIMARY}/a.ts`])
    expect(seen.commands).toEqual([anchored(`git -C '${PRIMARY}' push`)])
    const shown = await $.command.run({ command: 'anchor', args: '' })
    expect(shown.text).toContain('OPEN')
  })

  test('anchored in the primary checkout itself, nothing is guarded', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: PRIMARY, surface: null, isInteractive: false })

    await $.tool.call({ tool: 'Edit', file_path: `${PRIMARY}/a.ts`, old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })

    expect(seen.edits).toEqual([`${PRIMARY}/a.ts`])
    expect(seen.commands).toEqual([anchored('git commit -m x', `'${PRIMARY}'`)])
  })

  test('a failing git leaves a bare anchor instead of throwing', async ($, on) => {
    const seen = world(on, { isGitBroken: true })
    await $.session.start({ cwd: WORKTREE, surface: null, isInteractive: false })

    await $.tool.call({ tool: 'Edit', file_path: `${PRIMARY}/a.ts`, old_string: 'a', new_string: 'b' })
    expect(seen.edits).toEqual([`${PRIMARY}/a.ts`])
  })

  test('a cwd through a symlink still guards the primary, in either spelling', async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: LINKED, surface: null, isInteractive: false })
    const shown = await $.command.run({ command: 'anchor', args: '' })
    expect(shown.text).toContain(`PRIMARY ${LINKED_PRIMARY}`)

    const logical = await $.tool.call({ tool: 'Edit', file_path: `${LINKED_PRIMARY}/a.ts`, old_string: 'a', new_string: 'b' })
    const real = await $.tool.call({ tool: 'Write', file_path: `${REAL_PRIMARY}/b.ts`, content: 'x' })
    const viaCd = await $.tool.call({ tool: 'Bash', command: `cd ${LINKED_PRIMARY} && git commit -m x` })
    expect(logical.deny).toContain('/anchor off')
    expect(real.deny).toContain('/anchor off')
    expect(viaCd.deny).toContain('git commit')

    await $.tool.call({ tool: 'Edit', file_path: `${LINKED}/a.ts`, old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Edit', file_path: `${REAL_LINKED}/a.ts`, old_string: 'a', new_string: 'b' })
    expect(seen.edits).toEqual([`${LINKED}/a.ts`, `${REAL_LINKED}/a.ts`])
  })
})
