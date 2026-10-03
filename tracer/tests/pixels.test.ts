import { describe, expect, test } from 'claude-code/testing'

import { buildStages } from '../hooks/chain'
import { PICO, halfBlockRows, levelMap, plainMap } from '../hooks/pixels'

const PALETTE = new Set<string>(Object.values(PICO))

const STAGES = buildStages({
  runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
  deployments: [{ id: 1, environment: 'production', createdAt: '2026-10-01T10:00:00Z', state: 'in_progress' }],
  environments: [],
  hasLiveUrl: true,
  live: null,
})

describe('half-block renderer', () => {
  test('two pixel rows per terminal row, top as color and bottom as background', () => {
    const rows = halfBlockRows(['yr', 'y.', '..', '.y'])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual([
      { text: '▀', color: PICO.yellow, backgroundColor: PICO.yellow },
      { text: '▀', color: PICO.red },
    ])
    expect(rows[1]).toEqual([{ text: ' ' }, { text: '▄', color: PICO.yellow }])
  })
})

describe('level map', () => {
  test('one node per stage, two terminal rows tall, then two label rows', () => {
    const map = levelMap(STAGES, true)
    expect(map.pixels).toHaveLength(2)
    expect(map.labels).toHaveLength(2)
    const top = map.labels[0]?.map(cell => cell.text).join('') ?? ''
    for (const label of ['★ MERGED', '★ BUILD', '● DEPLOY', '● LIVE']) expect(top).toContain(label)
    expect(map.labels[1]?.map(cell => cell.text).join('')).toContain('PRODUCT~')
  })

  test('uses only PICO-8 colours', () => {
    const map = levelMap(STAGES, true)
    for (const runs of [...map.pixels, ...map.labels]) {
      for (const run of runs) {
        if (run.color) expect(PALETTE.has(run.color)).toBe(true)
        if (run.backgroundColor) expect(PALETTE.has(run.backgroundColor)).toBe(true)
      }
    }
  })

  test('the stage you are on is blue, a failed one red, a done one yellow', () => {
    const map = levelMap(STAGES, true)
    const colors = map.labels[0]?.filter(cell => cell.text.trim() !== '').map(cell => cell.color)
    expect(colors).toEqual([PICO.yellow, PICO.yellow, PICO.blue, PICO.lightGrey])
    const failed = buildStages({ runs: [{ name: 'ci', status: 'completed', conclusion: 'failure' }], deployments: [], environments: [], hasLiveUrl: false, live: null })
    expect(levelMap(failed, false).labels[0]?.filter(cell => cell.text.trim() !== '').map(cell => cell.color)).toEqual([PICO.yellow, PICO.red])
  })

  test('the plain capture is single-width and the rows line up', () => {
    const lines = plainMap(STAGES, true)
    expect(lines).toHaveLength(4)
    const widths = new Set(lines.map(line => line.length))
    expect(widths.size).toBe(1)
    for (const line of lines) expect(/[\u{1F000}-\u{1FFFF}]/u.test(line)).toBe(false)
  })

  test('five stages fit in 50 columns', () => {
    const five = buildStages({
      runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
      deployments: [],
      environments: ['staging', 'production-europe'],
      hasLiveUrl: true,
      live: null,
    })
    expect(plainMap(five, true)[0]?.length).toBeLessThanOrEqual(50)
  })

  const MANY = buildStages({
    runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
    deployments: [{ id: 1, environment: 'preview', createdAt: '2026-10-01T10:00:00Z', state: 'success' }],
    environments: ['preview', 'staging', 'qa', 'dev', 'production'],
    hasLiveUrl: true,
    live: null,
  })

  test('too wide for the pane, the deploy nodes fold into one DEPLOY 1/5 node', () => {
    expect(plainMap(MANY, true)[0]?.length).toBeGreaterThan(74)
    const lines = plainMap(MANY, true, 60)
    expect(lines).toHaveLength(4)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(60)
    expect(lines[2]).toContain('● DEPLOY')
    expect(lines[2]?.match(/DEPLOY/g)).toHaveLength(1)
    expect(lines[3]).toContain('1/5')
  })

  test('a folded DEPLOY with a failed environment is red', () => {
    const failed = buildStages({
      runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
      deployments: [{ id: 1, environment: 'qa', createdAt: '2026-10-01T10:00:00Z', state: 'failure' }],
      environments: ['preview', 'staging', 'qa', 'dev', 'production'],
      hasLiveUrl: false,
      live: null,
    })
    const labels = levelMap(failed, false, 40).labels[0]?.filter(cell => cell.text.trim() !== '')
    expect(labels?.map(cell => cell.text.trim())).toEqual(['★ MERGED', '★ BUILD', '✕ DEPLOY'])
    expect(labels?.at(-1)?.color).toBe(PICO.red)
  })

  test('narrower than even the folded map: no map at all', () => {
    expect(levelMap(MANY, true, 20)).toEqual({ pixels: [], labels: [] })
  })
})
