import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const PANE_PROPS = {
  title: 'SENTRY',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}
const SHA = 'abc1234def5678'
const RED = '#FF004D'
const DARK_GREY = '#5F574F'

function github(on: On, runs: { name: string; status: string; conclusion: string | null }[]) {
  const statuses: (string | undefined)[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const argv = e.argv
    if (argv[1] === 'repo') return { value: { exitCode: 0, stdout: 'acme/app\n', stderr: '' } }
    if (argv[2] === 'graphql') {
      const pullRequest = {
        number: 12,
        title: 'Add login retry',
        url: 'https://github.com/acme/app/pull/12',
        state: 'OPEN',
        headRefOid: SHA,
        mergeStateStatus: 'BLOCKED',
        reviewDecision: 'REVIEW_REQUIRED',
        isInMergeQueue: false,
        mergedAt: null,
        reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ isResolved: false }] },
      }
      return { value: { exitCode: 0, stdout: JSON.stringify({ data: { repository: { pullRequest } } }), stderr: '' } }
    }
    return { value: { exitCode: 0, stdout: JSON.stringify({ total_count: runs.length, check_runs: runs }), stderr: '' } }
  })
  return statuses
}

describe('sentry pane', () => {
  for (const surface of SURFACES) {
    test(`empty pane says INSERT COIN on ${surface}`, async ($, on) => {
      mock.clock(on)
      github(on, [])
      await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
      const pane = await $.ui.mount({ plugin: 'sentry', surface, component: 'Pane', requestId: 'sentry', props: PANE_PROPS })
      expect((await pane.find({ key: 'empty' }))?.text).toContain('INSERT COIN')
      expect((await pane.find({ type: 'Text', text: '★' }))?.props.color).toBe(DARK_GREY)
    })

    test(`a watched PR draws its row of lights and a red beacon on failure on ${surface}`, async ($, on) => {
      mock.clock(on)
      github(on, [{ name: 'lint', status: 'completed', conclusion: 'failure' }])
      await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
      await $.command.run({ command: 'watch', args: '12' })
      const pane = await $.ui.mount({ plugin: 'sentry', surface, component: 'Pane', requestId: 'sentry', props: PANE_PROPS })
      expect((await pane.find({ type: 'Text', text: '★' }))?.props.color).toBe(RED)
      expect((await pane.find({ type: 'Text', text: '★' }))?.text).toContain('ALERT')
      const row = await pane.find({ key: 'pr-12' })
      for (const label of ['#12', 'Add login retry', 'CI', 'REVIEW', 'THREADS 1', 'QUEUE', 'MERGED', 'abc1234', 'lint']) {
        expect(row?.text).toContain(label)
      }
      const tower = await pane.find({ key: 'tower' })
      expect(tower?.text).toContain('▀')
    })

    test(`UNWATCH removes the PR on ${surface}`, async ($, on) => {
      mock.clock(on)
      const statuses = github(on, [])
      await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
      await $.command.run({ command: 'watch', args: '12' })
      const pane = await $.ui.mount({ plugin: 'sentry', surface, component: 'Pane', requestId: 'sentry', props: PANE_PROPS })
      await pane.press({ key: 'unwatch-12' })
      expect(await pane.find({ key: 'pr-12' })).toBeUndefined()
      expect(await pane.find({ key: 'empty' })).toBeDefined()
      expect(statuses.at(-1)).toBeUndefined()
    })
  }
})
