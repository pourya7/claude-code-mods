import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'anti-cheat'
const SURFACES = ['terminal', 'desktop'] as const
const BAND = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} }

/**
 * The engine beneath the plugin: Bash fails for commands holding FAIL, every
 * other tool succeeds; appends, submits and turn ends are recorded.
 */
const world = (on: On) => {
  const submitted: string[] = []
  // This kit routes no plugin's $.session.append to any hook (none of the
  // test's, none of a prepend plugin's), so the call rejects and the mod
  // falls back to a toast carrying the same foul line: the notice we read.
  const notices: string[] = []
  mock.clock(on)
  on('ui.toast', ($, e) => {
    notices.push(e.text)
    return { value: undefined } as never
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })
  on('tool.call', ($, e) => {
    const command = String((e as { command?: unknown }).command ?? '')
    if (e.tool === 'Bash') {
      const result = { stdout: '', stderr: '', interrupted: false }
      if (command.includes('BG')) return { result: { ...result, backgroundTaskId: 'task-1' } }
      return command.includes('FAIL') ? { result, isError: true } : { result }
    }
    return { result: {} }
  })
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({}) as never)
  return { notices, submitted }
}

let turns = 0
const startTurn = async ($: Engine) => {
  turns += 1
  await $.turn.start({ text: 'go', turnId: `t${turns}` })
}
const edit = ($: Engine) => $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })
const finish = ($: Engine, answer: string, reason: 'answer' | 'aborted' | 'error' = 'answer') =>
  $.turn.complete({ answer, durationMs: 10, isAborted: reason === 'aborted', turnId: `t${turns}`, reason })

const bandText = async ($: Engine, surface: (typeof SURFACES)[number]) => {
  const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })
  const lines = await band.findAll({ type: 'Text', text: /FOUL/ })
  return { band, lines: lines.map(line => line.text) }
}

describe('anti-cheat', () => {
  test('a claim with no evidence is flagged', async ($, on) => {
    const { notices } = world(on)
    await startTurn($)
    await edit($)
    await finish($, 'Fixed it. All tests pass.')

    expect(notices).toEqual(['⚑ FOUL: "All tests pass" — no test ran after the last edit'])
    for (const surface of SURFACES) {
      const { lines } = await bandText($, surface)
      expect(lines).toContain('⚑ FOUL: "All tests pass" — no test ran after the last edit')
    }
  })

  test('evidence after the last edit is not flagged', async ($, on) => {
    const { notices } = world(on)
    await startTurn($)
    await edit($)
    await bash($, 'cd /repo && npm test')
    await finish($, 'Fixed it. All tests pass.')

    expect(notices).toEqual([])
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })
      expect(await band.find({ text: /FOUL/ })).toBeUndefined()
    }
  })

  test('a test run before the last edit does not count', async ($, on) => {
    const { notices } = world(on)
    await startTurn($)
    await bash($, 'pytest')
    await edit($)
    await finish($, 'Tests pass.')
    expect(notices).toHaveLength(1)
  })

  test('evidence from an earlier turn counts when this turn made no edit', async ($, on) => {
    const { notices } = world(on)
    await startTurn($)
    await edit($)
    await bash($, 'pytest')
    await finish($, 'Done.')
    await startTurn($)
    await finish($, 'Yes, the tests pass.')
    expect(notices).toEqual([])
  })

  test('a failing test run is flagged', async ($, on) => {
    const { notices } = world(on)
    await startTurn($)
    await edit($)
    await bash($, 'pytest -x FAIL')
    await finish($, 'Tests pass now.')
    expect(notices[0]).toContain('the last test run failed (pytest -x FAIL)')
  })

  test('a CI claim after a push with no CI check is flagged', async ($, on) => {
    const { notices } = world(on)
    await startTurn($)
    await bash($, 'gh pr checks 42')
    await bash($, 'git push')
    await finish($, 'Pushed. CI is green.')
    expect(notices).toEqual(['⚑ FOUL: "CI is green" — no CI check ran after the last push'])
  })

  test('a CI check after the push backs the claim', async ($, on) => {
    const { notices } = world(on)
    await startTurn($)
    await bash($, 'git push')
    await bash($, 'gh pr checks 42 --watch')
    await finish($, 'CI is green.')
    expect(notices).toEqual([])
  })

  test('negations are not flagged', async ($, on) => {
    const { notices } = world(on)
    await startTurn($)
    await edit($)
    await finish($, 'The tests do not pass yet; I will fix the fixture next.')
    expect(notices).toEqual([])
  })

  test('aborted and errored turns are not checked', async ($, on) => {
    const { notices } = world(on)
    await startTurn($)
    await edit($)
    await finish($, 'All tests pass.', 'aborted')
    await startTurn($)
    await finish($, 'All tests pass.', 'error')
    expect(notices).toEqual([])
  })

  test('subagent turns and tool calls are ignored', async ($, on) => {
    const { notices } = world(on)
    await startTurn($)
    await edit($)
    await $.tool.call({ tool: 'Bash', command: 'pytest', agentId: 'sub-1' } as never)
    await $.turn.complete({ answer: 'tests pass', durationMs: 1, isAborted: false, turnId: 'sub', reason: 'answer', agentId: 'sub-1' })
    expect(notices).toEqual([])
    await finish($, 'All tests pass.')
    expect(notices).toHaveLength(1)
  })

  test('a subagent edit makes the main loop\'s earlier test run stale', async ($, on) => {
    const { notices } = world(on)
    await startTurn($)
    await bash($, 'pytest')
    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/b.ts', old_string: 'a', new_string: 'b', agentId: 'sub-1' } as never)
    await finish($, 'All tests pass.')
    expect(notices).toEqual(['⚑ FOUL: "All tests pass" — no test ran after the last edit'])
  })

  test('a test run piped into tail does not back a claim', async ($, on) => {
    const { notices } = world(on)
    await startTurn($)
    await edit($)
    // tail exits 0, so the tool call succeeds whatever pytest did.
    await bash($, 'pytest -x 2>&1 | tail -20')
    await finish($, 'All tests pass.')
    expect(notices).toEqual([
      '⚑ FOUL: "All tests pass" — the last test run\'s exit status was hidden by a pipe or a later command (pytest -x 2>&1 | tail -20)',
    ])
  })

  test('a test run with || true does not back a claim, with pipefail it does', async ($, on) => {
    const { notices } = world(on)
    await startTurn($)
    await edit($)
    await bash($, 'npm test || true')
    await finish($, 'Tests pass.')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('hidden by a pipe or a later command (npm test || true)')

    await startTurn($)
    await bash($, 'set -o pipefail; pytest | tail -5')
    await finish($, 'Tests pass.')
    expect(notices).toHaveLength(1)
  })

  test('installing a test tool is not a test run', async ($, on) => {
    const { notices } = world(on)
    await startTurn($)
    await edit($)
    await bash($, 'pip install pytest')
    await finish($, 'Tests pass.')
    expect(notices).toEqual(['⚑ FOUL: "Tests pass" — no test ran after the last edit'])
  })

  test('reading a CI run after a push does not back a CI claim', async ($, on) => {
    const { notices } = world(on)
    await startTurn($)
    await bash($, 'git push')
    await bash($, 'gh run view 123')
    await finish($, 'CI is green.')
    expect(notices).toEqual(['⚑ FOUL: "CI is green" — the CI status was only read (gh run view 123), which exits 0 even when CI fails'])

    await startTurn($)
    await bash($, 'gh run watch 123 --exit-status')
    await finish($, 'CI is green.')
    expect(notices).toHaveLength(1)
  })

  test('a test run moved to the background is pending, not failed', async ($, on) => {
    const { notices } = world(on)
    await startTurn($)
    await edit($)
    await bash($, 'npm test BG')
    await finish($, 'All tests pass.')
    expect(notices).toEqual(['⚑ FOUL: "All tests pass" — the last test run is still in the background (npm test BG)'])
  })

  test('Challenge submits the challenge and clears the band', async ($, on) => {
    const { submitted } = world(on)
    await startTurn($)
    await edit($)
    await finish($, 'All tests pass.')

    for (const surface of SURFACES) {
      const { band } = await bandText($, surface)
      expect(await band.find({ type: 'Button', key: 'challenge' })).toBeDefined()
      expect(await band.find({ type: 'Button', key: 'ok' })).toBeDefined()
    }
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND })
    await band.press({ key: 'challenge' })
    expect(submitted).toEqual([
      'anti-cheat: you said "All tests pass" but no test ran after the last edit. Run the check now and report the real result.',
    ])
    expect(await band.find({ text: /FOUL/ })).toBeUndefined()
  })

  test('OK dismisses without a prompt', async ($, on) => {
    const { submitted } = world(on)
    await startTurn($)
    await edit($)
    await finish($, 'Lint is clean.')
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })
      expect(await band.find({ text: /no lint or typecheck ran/ })).toBeDefined()
    }
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })
    await band.press({ key: 'ok' })
    expect(submitted).toEqual([])
    expect(await band.find({ text: /FOUL/ })).toBeUndefined()
  })

  test('a new turn clears the band', async ($, on) => {
    world(on)
    await startTurn($)
    await edit($)
    await finish($, 'Build passes.')
    await startTurn($)
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(await band.find({ text: /FOUL/ })).toBeUndefined()
  })

  test('the band yields to a survey', async ($, on) => {
    world(on)
    await startTurn($)
    await edit($)
    await finish($, 'Build passes.')
    for (const surface of SURFACES) {
      const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: { ...BAND, hasSurvey: true } })
      expect(await band.find({ text: /FOUL/ })).toBeUndefined()
    }
  })

  test('flag mode never auto-submits', async ($, on) => {
    const { submitted } = world(on)
    await startTurn($)
    await edit($)
    await finish($, 'All tests pass.')
    expect(submitted).toEqual([])
  })

  test('challenge mode auto-submits once per user prompt', { options: { mode: 'challenge' } }, async ($, on) => {
    const { submitted } = world(on)
    await startTurn($)
    await edit($)
    await finish($, 'All tests pass.')
    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toStartWith('anti-cheat: you said "All tests pass"')

    await startTurn($)
    await finish($, 'Still, all tests pass.')
    expect(submitted).toHaveLength(1)
  })

  test('challenge mode is not re-armed by a background task notification', { options: { mode: 'challenge' } }, async ($, on) => {
    const { submitted } = world(on)
    await startTurn($)
    await edit($)
    await finish($, 'All tests pass.')
    expect(submitted).toHaveLength(1)

    await $.prompt.submit({ text: 'task done', origin: { kind: 'task-notification' }, wait: false } as never)
    await startTurn($)
    await finish($, 'All tests pass.')
    expect(submitted.filter(text => text.startsWith('anti-cheat:'))).toHaveLength(1)

    await $.prompt.submit({ text: 'and now?', origin: { kind: 'composer' }, wait: false } as never)
    await startTurn($)
    await finish($, 'All tests pass.')
    expect(submitted.filter(text => text.startsWith('anti-cheat:'))).toHaveLength(2)
  })

  test('/anti-cheat reports the log', async ($, on) => {
    world(on)
    await startTurn($)
    await edit($)
    await bash($, 'npm test')
    const answer = await $.command.run({
      command: 'anti-cheat',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 100 },
    } as never)
    expect(answer.text).toContain('last edit: /repo/src/a.ts')
    expect(answer.text).toContain('✓ npm test')
  })
})
