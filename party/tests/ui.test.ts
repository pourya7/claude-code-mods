import { describe, expect, test } from 'claude-code/testing'

import { NOW, PANE_PROPS, START, other, world } from './world'

const SURFACES = ['terminal', 'desktop'] as const
const RED = '#FF004D'
const YELLOW = '#FFEC27'
const DARK_GREY = '#5F574F'

describe('party pane', () => {
  for (const surface of SURFACES) {
    test(`the raid frame lists every live session with its icon, bar and place on ${surface}`, async ($, on) => {
      world(on, {
        'session:other-session': other({ state: 'waiting-on-you', waitingFor: 'permission', since: NOW - 6 * 60_000 }),
      })
      await $.session.start({ ...START, surface })
      const pane = await $.ui.mount({ plugin: 'party', surface, component: 'Pane', requestId: 'party', props: PANE_PROPS })

      expect((await pane.find({ key: 'summary' }))?.text).toContain('2 IN PARTY · 1 WAITING ON YOU')
      expect((await pane.find({ key: 'banner' }))?.text).toContain('▀')

      const waiting = await pane.find({ key: 'member-other-session' })
      for (const label of ['2P', 'ship the release', 'WAITING ON YOU · PERMISSION', '6M', 'app-two@feat/release', 'LAST Bash']) {
        expect(waiting?.text).toContain(label)
      }
      expect((await pane.find({ key: 'icon-other-session' }))?.text).toMatch(/[▀▄]/)
      const bar = await pane.find({ key: 'bar-other-session' })
      expect(bar?.text).toBe('██████████')
      expect((await pane.find({ type: 'Text', text: '██████████' }))?.props.color).toBe(RED)

      const mine = await pane.find({ key: 'member-self-session' })
      expect(mine?.text).toContain('1UP')
      expect(mine?.text).toContain('IDLE')
      expect(mine?.text).toContain('app@feat/login')
    })

    test(`a short wait fills part of the bar in yellow, a working session shows none on ${surface}`, async ($, on) => {
      world(on, {
        'session:other-session': other({ state: 'waiting-on-you', waitingFor: 'question', since: NOW - 3 * 60_000 }),
        'session:busy': other({ sessionId: 'busy', title: 'refactor the cache', state: 'working' }),
      })
      await $.session.start({ ...START, surface })
      const pane = await $.ui.mount({ plugin: 'party', surface, component: 'Pane', requestId: 'party', props: PANE_PROPS })
      expect((await pane.find({ key: 'bar-other-session' }))?.text).toBe('██████░░░░')
      expect((await pane.find({ type: 'Text', text: '██████' }))?.props.color).toBe(YELLOW)
      const busy = await pane.find({ key: 'bar-busy' })
      expect(busy?.text).toBe('░░░░░░░░░░')
      expect((await pane.find({ key: 'member-busy' }))?.text).toContain('WORKING')
      expect((await pane.find({ type: 'Text', text: '░░░░░░░░░░' }))?.props.color).toBe(DARK_GREY)
    })

    test(`the pane redraws on the next heartbeat on ${surface}`, async ($, on) => {
      const w = world(on)
      await $.session.start({ ...START, surface })
      const pane = await $.ui.mount({ plugin: 'party', surface, component: 'Pane', requestId: 'party', props: PANE_PROPS })
      expect((await pane.find({ key: 'summary' }))?.text).toContain('1 IN PARTY')
      w.store['session:late'] = other({ sessionId: 'late', beatAt: NOW + 10_000 })
      await w.clock.advance(15_000)
      expect((await pane.find({ key: 'summary' }))?.text).toContain('2 IN PARTY')
      expect(await pane.find({ key: 'member-late' })).toBeDefined()
    })
  }
})
