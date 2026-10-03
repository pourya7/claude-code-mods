import { describe, expect, test } from 'claude-code/testing'
import { autoSwitch, detectStance } from '../hooks/detect'
import { parseStance } from '../hooks/stances'

describe('detectStance', () => {
  test('investigate phrases', () => {
    for (const text of [
      'This is an investigation task, look at the logs',
      'Investigation only please',
      'no code, just tell me why',
      'No commit until I say',
      'no commits',
      'NO PR yet',
      'findings only',
    ]) {
      expect(detectStance(text), text).toBe('investigate')
    }
  })

  test('draft phrases', () => {
    expect(detectStance('Write the reply but do not send it')).toBe('draft')
    expect(detectStance('do not post anything')).toBe('draft')
    expect(detectStance('Do NOT reply on the thread')).toBe('draft')
    expect(detectStance('draft only')).toBe('draft')
  })

  test('the stricter stance wins when both match', () => {
    expect(detectStance('draft only, no code')).toBe('investigate')
  })

  test('ordinary prompts match nothing', () => {
    expect(detectStance('fix the encoder and open a PR')).toBeUndefined()
    expect(detectStance('decode the barcode')).toBeUndefined()
    expect(detectStance('the PR number is 42')).toBeUndefined()
  })
})

describe('autoSwitch', () => {
  test('switches from the default', () => {
    expect(autoSwitch({ stance: 'build', source: 'default' }, 'investigate')).toEqual({ to: 'investigate' })
  })

  test('no change when already there', () => {
    expect(autoSwitch({ stance: 'investigate', source: 'auto' }, 'investigate')).toBeUndefined()
  })

  test('tightens a stance the person chose', () => {
    expect(autoSwitch({ stance: 'build', source: 'person', personStance: 'build' }, 'draft')).toEqual({ to: 'draft' })
  })

  test('never loosens below the stance the person chose; names that stance', () => {
    expect(autoSwitch({ stance: 'investigate', source: 'person', personStance: 'investigate' }, 'draft')).toEqual({ kept: 'investigate' })
  })

  test('may loosen a stance it set itself, down to the person’s choice', () => {
    expect(autoSwitch({ stance: 'investigate', source: 'auto', personStance: 'build' }, 'draft')).toEqual({ to: 'draft' })
    expect(autoSwitch({ stance: 'investigate', source: 'auto' }, 'draft')).toEqual({ to: 'draft' })
  })
})

describe('parseStance', () => {
  test('names and short names', () => {
    expect(parseStance('investigate')).toBe('investigate')
    expect(parseStance(' INV ')).toBe('investigate')
    expect(parseStance('Draft')).toBe('draft')
    expect(parseStance('build')).toBe('build')
    expect(parseStance('ship')).toBe('ship')
    expect(parseStance('yolo')).toBeUndefined()
  })
})
