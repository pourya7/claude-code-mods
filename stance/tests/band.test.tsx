import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80 }
const PRESENTATION = { isFullscreen: false, columns: 100 }

/** The engine beneath the plugin: draws nothing of its own, keeps UI lines quiet. */
const world = (on: On) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: 'ok' }) as never)
}

const mountBand = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'stance', surface, component: 'AbovePrompt', props: PROPS as never })

const setStance = ($: Engine, args: string) =>
  $.command.run({ command: 'stance', args, origin: { kind: 'composer' }, presentation: PRESENTATION })

describe('band', () => {
  test('hidden in build by default', async ($, on) => {
    world(on)
    for (const surface of SURFACES) {
      const ui = await mountBand($, surface)
      expect(await ui.find({ key: 'stance-name' }), surface).toBeUndefined()
      await ui.unmount()
    }
  })

  test('shown in build when showBuild is on', { options: { showBuild: true } }, async ($, on) => {
    world(on)
    for (const surface of SURFACES) {
      const ui = await mountBand($, surface)
      expect((await ui.find({ key: 'stance-name' }))?.text, surface).toContain('BUILD')
      await ui.unmount()
    }
  })

  test('draws badge, name and four buttons; buttons switch the stance', async ($, on) => {
    world(on)
    for (const surface of SURFACES) {
      await setStance($, 'investigate')
      const ui = await mountBand($, surface)
      expect((await ui.find({ key: 'stance-name' }))?.text, surface).toContain('INVESTIGATE')
      expect(await ui.find({ key: 'badge' }), surface).toBeDefined()
      const buttons = await ui.findAll({ type: 'Button' })
      expect(buttons.map(button => button.text)).toEqual(['INV', 'DRAFT', 'BUILD', 'SHIP'])

      await ui.press({ key: 'to-draft' })
      expect((await ui.find({ key: 'stance-name' }))?.text, surface).toContain('DRAFT')
      const denied = await $.tool.call({ tool: 'Bash', command: 'git push' })
      expect(denied.isError === true || denied.deny !== undefined, surface).toBe(true)

      await ui.press({ key: 'to-ship' })
      expect((await ui.find({ key: 'stance-name' }))?.text, surface).toContain('SHIP')
      expect((await ui.find({ key: 'tagline' }))?.text, surface).toContain('VERIFY')

      await ui.press({ key: 'to-build' })
      expect(await ui.find({ key: 'stance-name' }), surface).toBeUndefined()
      expect((await setStance($, '')).text).toContain('BUILD')
      await ui.unmount()
    }
  })

  test('stays out of the way of a survey', async ($, on) => {
    world(on)
    await setStance($, 'draft')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'stance', surface, component: 'AbovePrompt', props: { ...PROPS, hasSurvey: true } as never })
      expect(await ui.find({ key: 'stance-name' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('fits the style guide: at most 6 rows', async ($, on) => {
    world(on)
    await setStance($, 'investigate')
    for (const surface of SURFACES) {
      const ui = await mountBand($, surface)
      const badge = await ui.find({ key: 'badge' })
      expect(badge?.children.length).toBe(4)
      const info = await ui.find({ key: 'info' })
      expect(info?.children.length).toBeLessThanOrEqual(6)
      await ui.unmount()
    }
  })
})
