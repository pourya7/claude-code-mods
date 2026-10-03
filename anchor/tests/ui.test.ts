import { describe, expect, test } from 'claude-code/testing'

import { replyLines } from '../hooks/describe'

const SURFACES = ['terminal', 'desktop'] as const

const POINT = {
  isOn: true,
  path: '/work/repo/.worktrees/fix-login',
  root: '/work/repo/.worktrees/fix-login',
  primary: '/work/repo',
  name: 'fix-login',
  branch: 'fix/login',
}

const props = (text: string) => ({ command: 'anchor', args: '', text, isErrored: false })

describe('/anchor reply', () => {
  for (const surface of SURFACES) {
    test(`draws the pixel anchor and the paths on ${surface}`, async $ => {
      const ui = await $.ui.mount({
        plugin: 'anchor',
        surface,
        component: 'CommandOutput',
        props: props(replyLines(POINT, true).join('\n')),
      })

      const title = await ui.find({ type: 'Text', text: /^╋ ANCHOR/ })
      expect(title?.text).toBe('╋ ANCHOR SET  fix-login@fix/login')
      expect(title?.props.color).toBe('#29ADFF')

      const pixels = await ui.findAll({ type: 'Text', text: /[▀▄█]/ })
      expect(pixels.length).toBeGreaterThan(5)
      expect(pixels.some(cell => cell.props.color === '#29ADFF')).toBe(true)

      expect((await ui.find({ type: 'Text', text: '/work/repo/.worktrees/fix-login' }))?.text).toBe(
        '/work/repo/.worktrees/fix-login',
      )
      expect(await ui.find({ type: 'Text', text: 'GUARDED' })).toBeDefined()
    })

    test(`greys the anchor out when off on ${surface}`, async $ => {
      const ui = await $.ui.mount({
        plugin: 'anchor',
        surface,
        component: 'CommandOutput',
        props: props(replyLines({ ...POINT, isOn: false }, true).join('\n')),
      })

      expect((await ui.find({ type: 'Text', text: /^╋ ANCHOR/ }))?.text).toContain('ANCHOR OFF')
      const pixels = await ui.findAll({ type: 'Text', text: /[▀▄█]/ })
      expect(pixels.some(cell => cell.props.color === '#29ADFF')).toBe(false)
      expect(pixels.some(cell => cell.props.color === '#5F574F')).toBe(true)
    })

    test(`uses only PICO-8 colours and single-width glyphs on ${surface}`, async $ => {
      const ui = await $.ui.mount({
        plugin: 'anchor',
        surface,
        component: 'CommandOutput',
        props: props(replyLines(POINT, true).join('\n')),
      })
      const pico8 = [
        '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
        '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
      ]
      for (const cell of await ui.findAll({ type: 'Text' })) {
        for (const colour of [cell.props.color, cell.props.backgroundColor]) {
          if (colour !== undefined) expect(pico8).toContain(colour)
        }
        expect(/\p{Extended_Pictographic}/u.test(cell.text)).toBe(false)
      }
    })
  }
})
