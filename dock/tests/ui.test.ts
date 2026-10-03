import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PANE_PROPS, START, SURFACES, dockCommand, world } from './world'

const RED = '#FF004D'
const BLUE = '#29ADFF'

const mountPane = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'dock', surface, component: 'Pane', requestId: 'dock', props: PANE_PROPS })

describe('dock pane', () => {
  for (const surface of SURFACES) {
    test(`draws the crane, the fuel gauge and one row per stack on ${surface}`, async ($, on) => {
      world(on)
      await $.session.start({ ...START, surface })
      await $.command.run(dockCommand())
      const pane = await mountPane($, surface)
      expect((await pane.find({ key: 'crane' }))?.text).toContain('▀')
      const gauge = await pane.find({ key: 'gauge' })
      expect(gauge?.text).toContain('5.0/8.0 GIB')
      expect((await pane.find({ key: 'headroom' }))?.text).toContain('HEADROOM 3.0 GIB')
      for (const name of ['app', 'feature-x', 'api']) expect(await pane.find({ key: `stack-${name}` })).toBeDefined()
      const app = await pane.find({ key: 'stack-app' })
      for (const label of ['app', 'UP 2', '2.0G', '/work/app', 'DOWN']) expect(app?.text).toContain(label)
    })

    test(`a stack whose worktree is gone reads ORPHAN in red on ${surface}`, async ($, on) => {
      world(on)
      await $.session.start({ ...START, surface })
      await $.command.run(dockCommand())
      const pane = await mountPane($, surface)
      const orphan = await pane.find({ key: 'where-feature-x' })
      expect(orphan?.text).toContain('ORPHAN')
      expect((await pane.find({ type: 'Text', text: 'ORPHAN' }))?.props.color).toBe(RED)
      expect((await pane.find({ key: 'where-app' }))?.text).not.toContain('ORPHAN')
    })

    test(`low fuel turns the headroom red on ${surface}`, { options: { minHeadroomGiB: 4 } }, async ($, on) => {
      world(on)
      await $.session.start({ ...START, surface })
      await $.command.run(dockCommand())
      const pane = await mountPane($, surface)
      const headroom = await pane.find({ key: 'headroom' })
      expect(headroom?.text).toContain('LOW FUEL')
      expect((await pane.find({ type: 'Text', text: 'HEADROOM' }))?.props.color).toBe(RED)
    })

    test(`plenty of fuel is blue on ${surface}`, async ($, on) => {
      world(on)
      await $.session.start({ ...START, surface })
      await $.command.run(dockCommand())
      const pane = await mountPane($, surface)
      expect((await pane.find({ type: 'Text', text: 'HEADROOM' }))?.props.color).toBe(BLUE)
    })

    test(`DOWN copies the exact command and runs nothing on ${surface}`, async ($, on) => {
      const machine = world(on)
      await $.session.start({ ...START, surface })
      await $.command.run(dockCommand())
      const before = machine.runs.length
      const pane = await mountPane($, surface)
      await pane.press({ key: 'down-feature-x' })
      expect(machine.copied).toEqual(['docker compose -p feature-x down'])
      expect(machine.runs).toHaveLength(before)
      expect(machine.toasts.at(-1)).toContain('docker compose -p feature-x down')
    })

    test(`DOWN falls back to the prompt box without a clipboard on ${surface}`, async ($, on) => {
      const machine = world(on)
      machine.copyWorks = false
      await $.session.start({ ...START, surface })
      await $.command.run(dockCommand())
      const pane = await mountPane($, surface)
      await pane.press({ key: 'down-app' })
      expect(machine.filled).toEqual(['docker compose -p app down'])
      expect(machine.draft).toBe('docker compose -p app down')
    })

    test(`DOWN never touches a draft the person is typing on ${surface}`, async ($, on) => {
      const machine = world(on)
      machine.copyWorks = false
      machine.draft = 'please refactor the'
      await $.session.start({ ...START, surface })
      await $.command.run(dockCommand())
      const pane = await mountPane($, surface)
      await pane.press({ key: 'down-app' })
      expect(machine.draft).toBe('please refactor the')
      expect(machine.filled).toEqual([])
      expect(machine.toasts.at(-1)).toContain('RUN IT YOURSELF: docker compose -p app down')
    })

    test(`the diamond marks only the nested worktree's stack, not its main checkout's, on ${surface}`, async ($, on) => {
      const machine = world(on)
      machine.dirs.push('/work/app/.worktrees/feature-x')
      await $.session.start({ ...START, cwd: '/work/app/.worktrees/feature-x', surface })
      await $.command.run(dockCommand())
      const pane = await mountPane($, surface)
      expect((await pane.find({ key: 'stack-feature-x' }))?.text).toContain('◆')
      expect((await pane.find({ key: 'stack-app' }))?.text).not.toContain('◆')
      expect((await pane.find({ key: 'stack-api' }))?.text).not.toContain('◆')
    })

    test(`RESCAN reads docker again on ${surface}`, async ($, on) => {
      const machine = world(on)
      await $.session.start({ ...START, surface })
      await $.command.run(dockCommand())
      const pane = await mountPane($, surface)
      await pane.press({ key: 'rescan' })
      expect(machine.runs.filter(argv => argv[1] === 'info')).toHaveLength(2)
    })

    test(`no docker: the pane says so on ${surface}`, async ($, on) => {
      world(on, 'missing')
      await $.session.start({ ...START, surface })
      await $.command.run(dockCommand())
      const pane = await mountPane($, surface)
      expect((await pane.find({ key: 'offline' }))?.text).toContain('NO DOCKER')
      expect(await pane.find({ key: 'gauge' })).toBeUndefined()
    })

    test(`daemon down: the pane says so on ${surface}`, async ($, on) => {
      world(on, 'daemon-down')
      await $.session.start({ ...START, surface })
      await $.command.run(dockCommand())
      const pane = await mountPane($, surface)
      expect((await pane.find({ key: 'offline' }))?.text).toContain('DAEMON DOWN')
    })

    test(`before any scan the pane asks for one on ${surface}`, async ($, on) => {
      world(on)
      await $.session.start({ ...START, surface })
      const pane = await mountPane($, surface)
      expect((await pane.find({ key: 'offline' }))?.text).toContain('SCANNING')
    })
  }
})
