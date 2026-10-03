import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const PANE_PROPS = {
  title: 'TRACER',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}
const SHA = 'abc1234def5678abc1234def5678abc1234def56'
const RED = '#FF004D'
const YELLOW = '#FFEC27'

function github(on: On, conclusion: string | null) {
  const statuses: (string | undefined)[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isOpen: true } as never }))
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const argv = e.argv
    const json = (body: unknown) => ({ value: { exitCode: 0, stdout: JSON.stringify(body), stderr: '' } })
    if (argv[1] === 'repo') return { value: { exitCode: 0, stdout: 'acme/app\n', stderr: '' } }
    if (argv[1] === 'pr') return json({ number: 42, title: 'Add login retry', state: 'MERGED', mergeCommit: { oid: SHA } })
    if (argv[2]?.includes('actions/runs')) {
      return json({ total_count: 1, workflow_runs: [{ name: 'ci', status: conclusion === null ? 'in_progress' : 'completed', conclusion }] })
    }
    if (argv[2]?.includes('/statuses')) return json([{ state: 'queued' }])
    return json([{ id: 9, environment: 'production', created_at: '2026-10-01T10:00:00Z' }])
  })
  return statuses
}

describe('tracer pane', () => {
  for (const surface of SURFACES) {
    test(`empty pane says INSERT COIN on ${surface}`, async ($, on) => {
      mock.clock(on)
      github(on, null)
      await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
      const pane = await $.ui.mount({ plugin: 'tracer', surface, component: 'Pane', requestId: 'tracer', props: PANE_PROPS })
      expect((await pane.find({ key: 'empty' }))?.text).toContain('INSERT COIN')
    })

    test(`a trace draws the level map with its stages on ${surface}`, async ($, on) => {
      mock.clock(on)
      github(on, 'success')
      await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
      await $.command.run({ command: 'trace', args: '42' })
      const pane = await $.ui.mount({ plugin: 'tracer', surface, component: 'Pane', requestId: 'tracer', props: PANE_PROPS })
      const block = await pane.find({ key: `trace-${SHA}` })
      for (const label of ['#42', 'Add login retry', 'abc1234', 'ON THE ROAD', 'MERGED', 'BUILD', 'DEPLOY', 'PRODUCT~', 'QUEUED']) {
        expect(block?.text).toContain(label)
      }
      const map = await pane.find({ key: `map-${SHA}` })
      expect(map?.text).toContain('▀')
    })

    test(`a failed trace shows GAME OVER in red on ${surface}`, async ($, on) => {
      mock.clock(on)
      github(on, 'failure')
      await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
      await $.command.run({ command: 'trace', args: '42' })
      const pane = await $.ui.mount({ plugin: 'tracer', surface, component: 'Pane', requestId: 'tracer', props: PANE_PROPS })
      expect((await pane.find({ key: `outcome-${SHA}` }))?.text).toContain('GAME OVER: BUILD FAILED')
      expect((await pane.find({ type: 'Text', text: 'GAME OVER' }))?.props.color).toBe(RED)
    })

    test(`the title is in the signature yellow on ${surface}`, async ($, on) => {
      mock.clock(on)
      github(on, null)
      await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
      const pane = await $.ui.mount({ plugin: 'tracer', surface, component: 'Pane', requestId: 'tracer', props: PANE_PROPS })
      expect((await pane.find({ type: 'Text', text: 'T R A C E R' }))?.props.color).toBe(YELLOW)
    })

    test(`five environments fold into one DEPLOY node in a narrow pane on ${surface}`, { options: { environments: 'preview, staging, qa, dev, production', liveUrl: 'https://app.example.com/version' } }, async ($, on) => {
      mock.clock(on)
      github(on, 'success')
      await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
      await $.command.run({ command: 'trace', args: '42' })
      const pane = await $.ui.mount({ plugin: 'tracer', surface, component: 'Pane', requestId: 'tracer', props: { ...PANE_PROPS, bodyColumns: 50 } })
      const map = await pane.find({ key: `map-${SHA}` })
      expect(map?.text).toContain('▀')
      expect(map?.text).toContain('0/5')
      expect(map?.text).not.toContain('STAGING')
      // The map is four rows (two of pixels, two of labels); its text joins them.
      expect((map?.text.length ?? 0) / 4).toBeLessThanOrEqual(50)
      expect((await pane.find({ key: `trace-${SHA}` }))?.text).toContain('DEPLOY:STAGING')
    })

    test(`STOP removes the trace on ${surface}`, async ($, on) => {
      mock.clock(on)
      const statuses = github(on, null)
      await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
      await $.command.run({ command: 'trace', args: '42' })
      const pane = await $.ui.mount({ plugin: 'tracer', surface, component: 'Pane', requestId: 'tracer', props: PANE_PROPS })
      await pane.press({ key: `stop-${SHA}` })
      expect(await pane.find({ key: `trace-${SHA}` })).toBeUndefined()
      expect(await pane.find({ key: 'empty' })).toBeDefined()
      expect(statuses.at(-1)).toBeUndefined()
    })
  }
})
