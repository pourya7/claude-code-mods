import { describe, expect, test } from 'claude-code/testing'

import { PANE_PROPS, START, dockCommand, onlyReads, world } from './world'

const heavyStats = (gib: number) => JSON.stringify({ ID: 'cccccccccccc', Name: 'feature-x-web-1', MemUsage: `${gib}GiB / 8GiB` })

describe('/dock', () => {
  test('registers the command and reads docker only when asked', async ($, on) => {
    const machine = world(on)
    await $.session.start(START)
    expect(machine.commands).toEqual(['dock'])
    expect(machine.runs).toHaveLength(0)
  })

  test('opens the pane, scans docker and answers with the summary', async ($, on) => {
    const machine = world(on)
    await $.session.start(START)
    const reply = await $.command.run(dockCommand())
    expect(machine.opened).toEqual(['dock'])
    expect(reply.text).toContain('5.0 of 8.0 GiB used')
    expect(reply.text).toMatch(/feature-x.*ORPHAN/)
    expect(machine.runs.map(argv => argv.slice(0, 3).join(' '))).toEqual([
      'docker info --format',
      'docker compose ls',
      'docker ps --all',
      'docker stats --no-stream',
    ])
  })

  test('says when docker is not installed', async ($, on) => {
    world(on, 'missing')
    await $.session.start(START)
    expect((await $.command.run(dockCommand())).text).toContain('NO DOCKER')
  })

  test('says when the daemon is down', async ($, on) => {
    world(on, 'daemon-down')
    await $.session.start(START)
    expect((await $.command.run(dockCommand())).text).toContain('DAEMON DOWN')
  })

  test('says when docker info reports server errors', async ($, on) => {
    const machine = world(on)
    machine.info = JSON.stringify({ ServerErrors: ['Cannot connect to the Docker daemon'] })
    await $.session.start(START)
    expect((await $.command.run(dockCommand())).text).toContain('DAEMON DOWN')
  })

  test('any other docker failure is reported, not thrown', async ($, on) => {
    world(on, 'broken')
    await $.session.start(START)
    expect((await $.command.run(dockCommand())).text).toContain('something odd happened')
  })
})

describe('refresh', () => {
  test('every 30 seconds while the pane is open, and never after it closes', async ($, on) => {
    const machine = world(on)
    await $.session.start(START)
    await $.command.run(dockCommand())
    const scans = () => machine.runs.filter(argv => argv[1] === 'info').length
    expect(scans()).toBe(1)
    await machine.clock.advance(29_000)
    expect(scans()).toBe(1)
    await machine.clock.advance(1_000)
    expect(scans()).toBe(2)
    await machine.clock.advance(30_000)
    expect(scans()).toBe(3)

    const pane = await $.ui.mount({
      plugin: 'dock',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'dock',
      props: { title: 'DOCK', isFocused: true, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 24 }, view: {} },
    })
    await pane.press({ key: 'close' })
    expect(machine.panes).toEqual([])
    await machine.clock.advance(300_000)
    expect(scans()).toBe(3)
  })

  // The pane list still names the pane after the press, so the tick-time pane
  // check cannot stop the timer: only the press itself can.
  test('CLOSE cancels the timer at the press, not at the next tick', async ($, on) => {
    const machine = world(on)
    await $.session.start(START)
    await $.command.run(dockCommand())
    const pane = await $.ui.mount({ plugin: 'dock', surface: 'terminal', component: 'Pane', requestId: 'dock', props: PANE_PROPS })
    await pane.press({ key: 'close' })
    machine.panes = ['dock']
    await machine.clock.advance(120_000)
    expect(machine.runs.filter(argv => argv[1] === 'info')).toHaveLength(1)
  })

  test('a hung docker keeps one probe outstanding across ticks', { options: { intervalSeconds: 5 } }, async ($, on) => {
    const machine = world(on)
    machine.panes = ['dock']
    await $.session.start(START)
    machine.docker = 'hung'
    for (let tick = 0; tick < 4; tick++) await machine.clock.advance(5_000)
    expect(machine.runs).toHaveLength(1)
    expect(machine.runs[0]?.[1]).toBe('info')
  })

  test('a pane closed some other way stops the timer at the next tick', async ($, on) => {
    const machine = world(on)
    await $.session.start(START)
    await $.command.run(dockCommand())
    machine.panes = []
    await machine.clock.advance(120_000)
    expect(machine.runs.filter(argv => argv[1] === 'info')).toHaveLength(1)
  })

  test('the interval comes from userConfig', { options: { intervalSeconds: 10 } }, async ($, on) => {
    const machine = world(on)
    await $.session.start(START)
    await $.command.run(dockCommand())
    await machine.clock.advance(10_000)
    expect(machine.runs.filter(argv => argv[1] === 'info')).toHaveLength(2)
  })

  test('running /dock twice keeps one timer', async ($, on) => {
    const machine = world(on)
    await $.session.start(START)
    await $.command.run(dockCommand())
    await $.command.run(dockCommand())
    await machine.clock.advance(30_000)
    expect(machine.runs.filter(argv => argv[1] === 'info')).toHaveLength(3)
  })
})

describe('guard', () => {
  const up = { tool: 'Bash', input: { command: 'docker compose up -d' } }
  /** The model's own call, not a query: it carries a tool_use_id. */
  const upCall = { ...up, tool_use_id: 'toolu_42' }

  test('enough headroom: the boot goes ahead', async ($, on) => {
    world(on)
    await $.session.start(START)
    expect((await $.tool.check(up)).decision).toBe('allow')
  })

  test('below the minimum: ask, naming the biggest stacks', async ($, on) => {
    const machine = world(on)
    machine.stats = heavyStats(6.5)
    await $.session.start(START)
    const checked = await $.tool.check(upCall)
    expect(checked.decision).toBe('ask')
    expect(checked.reason).toContain('1.5 GiB free of 8.0 GiB')
    expect(checked.reason).toContain('feature-x 6.5 GiB (ORPHAN)')
    expect(checked.reason).toContain('docker compose -p feature-x down')
    expect(machine.toasts.some(text => text.includes('LOW FUEL'))).toBe(true)
  })

  test('a real call always reads docker afresh', async ($, on) => {
    const machine = world(on)
    await $.session.start(START)
    await $.command.run(dockCommand())
    machine.stats = heavyStats(6.5)
    expect((await $.tool.check(upCall)).decision).toBe('ask')
    expect(machine.runs.filter(argv => argv[1] === 'info')).toHaveLength(2)
  })

  test('a query answers the same ask from the last scan, with no docker call and no toast', async ($, on) => {
    const machine = world(on)
    machine.stats = heavyStats(6.5)
    await $.session.start(START)
    await $.command.run(dockCommand())
    const before = machine.runs.length
    for (let query = 0; query < 3; query++) {
      const checked = await $.tool.check(up)
      expect(checked.decision).toBe('ask')
      expect(checked.reason).toContain('1.5 GiB free of 8.0 GiB')
    }
    expect(machine.runs).toHaveLength(before)
    expect(machine.toasts.some(text => text.includes('LOW FUEL'))).toBe(false)
  })

  test('a query before any scan reads docker once, but never toasts', async ($, on) => {
    const machine = world(on)
    machine.stats = heavyStats(6.5)
    await $.session.start(START)
    expect((await $.tool.check(up)).decision).toBe('ask')
    expect((await $.tool.check(up)).decision).toBe('ask')
    expect(machine.runs.filter(argv => argv[1] === 'info')).toHaveLength(1)
    expect(machine.toasts).toEqual([])
  })

  test('the minimum comes from userConfig', { options: { minHeadroomGiB: 4 } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    const checked = await $.tool.check({ tool: 'Bash', input: { command: 'docker-compose up' } })
    expect(checked.decision).toBe('ask')
  })

  test('headroom exactly at the minimum is enough', async ($, on) => {
    const machine = world(on)
    machine.stats = heavyStats(5)
    await $.session.start(START)
    expect((await $.tool.check(up)).decision).toBe('allow')
  })

  test('switched off: no ask, no docker call', { options: { guard: false } }, async ($, on) => {
    const machine = world(on)
    machine.stats = heavyStats(7.5)
    await $.session.start(START)
    expect((await $.tool.check(up)).decision).toBe('allow')
    expect(machine.runs).toHaveLength(0)
  })

  test('other commands are not probed', async ($, on) => {
    const machine = world(on)
    machine.stats = heavyStats(7.5)
    await $.session.start(START)
    for (const command of ['docker compose down', 'ls -la', 'docker ps']) {
      expect((await $.tool.check({ tool: 'Bash', input: { command } })).decision).toBe('allow')
    }
    expect((await $.tool.check({ tool: 'Edit', input: { file_path: '/work/app/x' } })).decision).toBe('allow')
    expect(machine.runs).toHaveLength(0)
  })

  test('docker down: the guard steps aside', async ($, on) => {
    world(on, 'daemon-down')
    await $.session.start(START)
    expect((await $.tool.check(up)).decision).toBe('allow')
  })

  test('a deny from below is never softened', async ($, on) => {
    const machine = world(on)
    machine.stats = heavyStats(7.5)
    machine.check = { decision: 'deny', reason: 'settings deny' }
    await $.session.start(START)
    expect(await $.tool.check(up)).toEqual({ decision: 'deny', reason: 'settings deny' })
  })

  test('the guard scan refreshes what the pane shows', async ($, on) => {
    const machine = world(on)
    machine.stats = heavyStats(6.5)
    await $.session.start(START)
    await $.tool.check(up)
    machine.docker = 'missing'
    expect((await $.command.run(dockCommand())).text).toContain('NO DOCKER')
  })
})

describe('never destructive', () => {
  test('a whole session of scans, guards and DOWN presses only ever reads', async ($, on) => {
    const machine = world(on)
    machine.stats = heavyStats(7)
    await $.session.start(START)
    await $.command.run(dockCommand())
    await machine.clock.advance(90_000)
    await $.tool.check({ tool: 'Bash', input: { command: 'docker compose up -d' } })
    const pane = await $.ui.mount({
      plugin: 'dock',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'dock',
      props: { title: 'DOCK', isFocused: true, bodyColumns: 64, placement: 'dock', scroll: { offset: 0, bodyRows: 24 }, view: {} },
    })
    await pane.press({ key: 'down-feature-x' })
    await pane.press({ key: 'down-app' })
    expect(machine.runs.length).toBeGreaterThan(0)
    expect(onlyReads(machine.runs)).toBe(true)
    expect(machine.copied).toEqual(['docker compose -p feature-x down', 'docker compose -p app down'])
  })
})
