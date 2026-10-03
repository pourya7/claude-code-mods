import { describe, expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'

import { DEFAULT_DIR, DIRTY, DOCKER, FORCE, HOME, START, STARTER, memoryFile, run, world } from './world'

let turns = 0
const startTurn = async ($: EngineInterface) => {
  turns += 1
  await $.turn.start({ text: 'go', turnId: `t${turns}` })
}
const bash = ($: EngineInterface, command: string, agentId?: string) =>
  $.tool.call({ tool: 'Bash', command, ...(agentId ? { agentId } : {}) } as never)

describe('indexing', () => {
  test('session.start indexes the project memory folder, registers /radar and sets the status', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.commands).toEqual(['radar'])
    expect(w.statuses.at(-1)).toBe('RADAR 3 ◉ 0 PINGS')
    expect(w.toasts).toEqual([])
    const reply = await $.command.run(run('list'))
    expect(reply.text).toContain(DEFAULT_DIR)
    expect(reply.text).toMatch(/Never checkout a dirty file[\s\S]*Docker stack capacity[\s\S]*Force push/)
  })

  test('autoMemoryDirectory from settings wins over the project folder', async ($, on) => {
    const w = world(on, { [`${HOME}/mem/a.md`]: DOCKER }, { autoMemoryDirectory: '~/mem' })
    await $.session.start(START)
    expect(w.statuses.at(-1)).toBe('RADAR 1 ◉ 0 PINGS')
  })

  test('userConfig.memoryDirs lists folders explicitly', { options: { memoryDirs: '~/a, /b' } }, async ($, on) => {
    const w = world(on, { [`${HOME}/a/x.md`]: DOCKER, '/b/y.md': FORCE, [`${DEFAULT_DIR}/z.md`]: DIRTY })
    await $.session.start(START)
    expect(w.statuses.at(-1)).toBe('RADAR 2 ◉ 0 PINGS')
  })

  test('malformed frontmatter is skipped with one toast; the rest still index', async ($, on) => {
    const w = world(on, {
      ...STARTER,
      [`${DEFAULT_DIR}/broken.md`]: '---\nname: nothing closes this\n',
      [`${DEFAULT_DIR}/nameless.md`]: '---\ndescription: d\n---\n',
    })
    await $.session.start(START)
    expect(w.toasts).toEqual(['RADAR ▸ 2 MEMORY FILES SKIPPED · /radar'])
    expect(w.statuses.at(-1)).toBe('RADAR 3 ◉ 0 PINGS')
    const reply = await $.command.run(run('list'))
    expect(reply.text).toMatch(/broken\.md.*not closed/)
    expect(reply.text).toMatch(/nameless\.md.*no name/)
  })

  test('a missing folder indexes nothing and never throws', async ($, on) => {
    const w = world(on, {})
    await $.session.start(START)
    expect(w.statuses.at(-1)).toBe('RADAR 0 ◉ 0 PINGS')
    const ran = await bash($, 'git checkout -- a.ts')
    expect(ran.context).toBeUndefined()
    expect(w.ran).toHaveLength(1)
    const reply = await $.command.run(run())
    expect(reply.text).toContain('no memory files')
  })

  test('a configured folder that does not exist is reported once', { options: { memoryDirs: '/gone, ~/a' } }, async ($, on) => {
    const w = world(on, { [`${HOME}/a/x.md`]: DOCKER })
    await $.session.start(START)
    expect(w.toasts).toEqual(['RADAR ▸ 1 FOLDER NOT FOUND · /radar'])
    expect(w.statuses.at(-1)).toBe('RADAR 1 ◉ 0 PINGS')
    expect((await $.command.run(run('list'))).text).toContain('folder not found: /gone')
  })

  test('/radar reload re-reads the folders', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    w.files[`${DEFAULT_DIR}/new.md`] = memoryFile('Release notes', 'write release notes by hand')
    const reply = await $.command.run(run('reload'))
    expect(reply.text).toContain('4 memories')
    expect(w.statuses.at(-1)).toBe('RADAR 4 ◉ 0 PINGS')
  })

  test('a second session.start (a hot reload or a /config change) re-reads the folders', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.statuses.at(-1)).toBe('RADAR 3 ◉ 0 PINGS')
    w.files[`${DEFAULT_DIR}/new.md`] = memoryFile('Release notes', 'write release notes by hand')
    await $.session.start(START)
    expect(w.statuses.at(-1)).toBe('RADAR 4 ◉ 0 PINGS')
    expect((await $.command.run(run('list'))).text).toContain('Release notes')
  })

  test('a trigger that nests a repeat is skipped with the toast, and a long command stays fast', async ($, on) => {
    const w = world(on, { ...STARTER, [`${DEFAULT_DIR}/slow.md`]: memoryFile('Slow', 'slow trigger', "triggers:\n  - '(\\S+\\s*)+--force'\n") })
    await $.session.start(START)
    expect(w.toasts).toEqual(['RADAR ▸ 1 MEMORY FILE SKIPPED · /radar'])
    expect((await $.command.run(run('list'))).text).toMatch(/slow\.md.*repeat inside a repeat/)
    await startTurn($)
    const started = Date.now()
    const ran = await bash($, `git push origin ${'a'.repeat(40)}`)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(ran.context).toBeUndefined()
  })

  test('only .md files are read, and subfolders are not walked', async ($, on) => {
    const w = world(on, { [`${DEFAULT_DIR}/a.md`]: DOCKER, [`${DEFAULT_DIR}/notes.txt`]: FORCE, [`${DEFAULT_DIR}/old/b.md`]: FORCE })
    await $.session.start(START)
    expect(w.statuses.at(-1)).toBe('RADAR 1 ◉ 0 PINGS')
  })
})

describe('attaching', () => {
  test('a trigger regex hit runs the call and attaches the memory with its rules', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await startTurn($)
    const ran = await bash($, 'git checkout -- src/a.ts')
    expect(w.ran).toHaveLength(1)
    expect(w.ran[0]?.command).toBe('git checkout -- src/a.ts')
    expect(ran.context).toHaveLength(1)
    expect(ran.context?.[0]).toContain('"Never checkout a dirty file"')
    expect(ran.context?.[0]).toContain('copy it aside first')
    expect(ran.context?.[0]).toContain('- Never run `git checkout -- <file>` on a dirty file.')
    expect(ran.context?.[0]).toContain('trigger match')
    expect(w.toasts).toEqual(['RADAR ▸ Never checkout a dirty file'])
    expect(w.statuses.at(-1)).toBe('RADAR 3 ◉ 1 PING')
  })

  test('keyword overlap attaches', async ($, on) => {
    world(on)
    await $.session.start(START)
    await startTurn($)
    const ran = await bash($, 'docker compose up -d')
    expect(ran.context?.[0]).toContain('"Docker stack capacity"')
    expect(ran.context?.[0]).toContain('keyword match: docker, compose')
  })

  test('file paths, URLs and MCP calls are read too', async ($, on) => {
    world(on, {
      [`${DEFAULT_DIR}/a.md`]: memoryFile('Auth login flow', 'the auth login module keeps its secrets elsewhere'),
      [`${DEFAULT_DIR}/b.md`]: memoryFile('Tracker team routing', 'tracker issues go to the ops team'),
      [`${DEFAULT_DIR}/c.md`]: memoryFile('Example api host', 'api.example.com rate limits hard'),
    })
    await $.session.start(START)
    await startTurn($)
    const edit = await $.tool.call({ tool: 'Edit', file_path: '/work/app/src/auth/login.ts', old_string: 'a', new_string: 'b' })
    expect(edit.context?.[0]).toContain('Auth login flow')
    const mcp = await $.tool.call({ tool: 'mcp__tracker__save_issue', team: 'ops', title: 'x' } as never)
    expect(mcp.context?.[0]).toContain('Tracker team routing')
    const fetched = await $.tool.call({ tool: 'WebFetch', url: 'https://api.example.com/v1/rate', prompt: 'p' })
    expect(fetched.context?.[0]).toContain('Example api host')
  })

  test('an unrelated call attaches nothing and pings nothing', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await startTurn($)
    const ran = await bash($, 'ls -la')
    expect(ran.context).toBeUndefined()
    expect(w.toasts).toEqual([])
    expect(w.ran).toHaveLength(1)
  })

  test('the same memory is not re-attached within a turn, and is again next turn', async ($, on) => {
    world(on)
    await $.session.start(START)
    await startTurn($)
    expect((await bash($, 'git checkout -- a.ts')).context).toHaveLength(1)
    expect((await bash($, 'git checkout -- b.ts')).context).toBeUndefined()
    await startTurn($)
    expect((await bash($, 'git checkout -- c.ts')).context).toHaveLength(1)
  })

  test('at most 2 memories attach to one call', async ($, on) => {
    world(on, {
      [`${DEFAULT_DIR}/a.md`]: memoryFile('Alpha', 'docker compose'),
      [`${DEFAULT_DIR}/b.md`]: memoryFile('Beta', 'docker compose stack'),
      [`${DEFAULT_DIR}/c.md`]: memoryFile('Gamma', 'docker compose stack worktree'),
    })
    await $.session.start(START)
    await startTurn($)
    const ran = await bash($, 'docker compose stack worktree')
    expect(ran.context).toHaveLength(2)
    expect(ran.context?.[0]).toContain('"Gamma"')
    expect(ran.context?.[1]).toContain('"Beta"')
  })

  test('reading, editing or cat-ing a memory file attaches nothing and pings nothing', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await startTurn($)
    const read = await $.tool.call({ tool: 'Read', file_path: `${DEFAULT_DIR}/docker.md` } as never)
    expect(read.context).toBeUndefined()
    const edit = await $.tool.call({ tool: 'Edit', file_path: `${DEFAULT_DIR}/docker.md`, old_string: 'docker compose', new_string: 'docker compose stack' })
    expect(edit.context).toBeUndefined()
    const cat = await bash($, 'cat ~/.claude/projects/-work-app/memory/docker.md | grep "docker compose"')
    expect(cat.context).toBeUndefined()
    expect(w.toasts).toEqual([])
    expect(w.ran).toHaveLength(3)
    // The memory was not claimed by those calls: it still attaches when it applies.
    expect((await bash($, 'docker compose up -d')).context?.[0]).toContain('"Docker stack capacity"')
  })

  test("an MCP call's consent text is not matched, only its arguments", async ($, on) => {
    world(on)
    await $.session.start(START)
    await startTurn($)
    const ran = await $.tool.call({ tool: 'mcp__x__send', title: 'hello', consent: 'The user pressed "1: Yes" on docker compose' } as never)
    expect(ran.context).toBeUndefined()
  })

  test('subagent calls are matched too, and share the turn dedup', async ($, on) => {
    world(on)
    await $.session.start(START)
    await startTurn($)
    const sub = await bash($, 'git checkout -- a.ts', 'agent-1')
    expect(sub.context?.[0]).toContain('Never checkout a dirty file')
    expect((await bash($, 'git checkout -- a.ts')).context).toBeUndefined()
  })

  test('a call refused beneath radar stays refused and pings nothing', async ($, on) => {
    const w = world(on)
    w.toolDeny = 'denied below'
    await $.session.start(START)
    await startTurn($)
    const ran = await bash($, 'git checkout -- a.ts')
    expect(ran.deny).toBe('denied below')
    expect(w.toasts).toEqual([])
    expect((await $.command.run(run('list'))).text).toContain('0 pings')
  })

  test('with toasts off, a ping only moves the status', { options: { toast: false } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await startTurn($)
    await bash($, 'git checkout -- a.ts')
    expect(w.toasts).toEqual([])
    expect(w.statuses.at(-1)).toBe('RADAR 3 ◉ 1 PING')
  })

  test('radar never writes a file', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await startTurn($)
    await bash($, 'git checkout -- a.ts')
    await bash($, 'docker compose up')
    await $.command.run(run('reload'))
    await $.command.run(run())
    expect(w.writes).toEqual([])
  })

  test('only the last 20 pings are kept for the pane, the count keeps going', async ($, on) => {
    world(on)
    await $.session.start(START)
    for (let i = 0; i < 25; i += 1) {
      await startTurn($)
      await bash($, `git checkout -- f${i}.ts`)
    }
    const reply = await $.command.run(run('list'))
    expect(reply.text).toContain('25 pings')
    expect(reply.text.match(/BASH {2}Never checkout/g)).toHaveLength(20)
  })
})

describe('/radar', () => {
  test('opens the pane and replies with the summary', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const reply = await $.command.run(run())
    expect(w.opened).toEqual([{ id: 'radar', title: 'RADAR · 3 MEMORIES' }])
    expect(reply.text).toContain('RADAR · 3 MEMORIES')
  })

  test('an unknown word shows the usage', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.command.run(run('explode'))).text).toContain('usage: /radar')
  })
})
