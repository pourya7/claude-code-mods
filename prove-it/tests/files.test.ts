import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_TEST_GLOBS, classifyFiles, globToRegExp, parseGlobList, parseNulList, splitCommand } from '../hooks/files'

describe('globs', () => {
  test('* stays inside one folder, ** crosses folders and may be empty', () => {
    expect(globToRegExp('src/*.ts').test('src/add.ts')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/lib/add.ts')).toBe(false)
    expect(globToRegExp('**/*.test.*').test('add.test.ts')).toBe(true)
    expect(globToRegExp('**/*.test.*').test('src/lib/add.test.ts')).toBe(true)
    expect(globToRegExp('tests/**').test('tests/unit/add.py')).toBe(true)
    expect(globToRegExp('tests/**').test('src/tests/add.py')).toBe(false)
  })

  test('? is one character and regex characters are literal', () => {
    expect(globToRegExp('a?.ts').test('ab.ts')).toBe(true)
    expect(globToRegExp('a?.ts').test('a/.ts')).toBe(false)
    expect(globToRegExp('a+b.ts').test('a+b.ts')).toBe(true)
    expect(globToRegExp('a+b.ts').test('aab.ts')).toBe(false)
  })

  test('a glob list is split on commas and blanks, empty entries dropped', () => {
    expect(parseGlobList(' **/*.test.*, tests/** ,,')).toEqual(['**/*.test.*', 'tests/**'])
    expect(parseGlobList('')).toEqual([])
    expect(parseGlobList(undefined)).toEqual([])
  })
})

describe('classifying the change', () => {
  test('the default test globs catch the common layouts; everything else is source', () => {
    const files = [
      'src/add.ts',
      'src/add.test.ts',
      'pkg/sum_test.go',
      'app/test_sum.py',
      'tests/test_api.py',
      'README.md',
    ]
    expect(classifyFiles(files, DEFAULT_TEST_GLOBS, [])).toEqual({
      tests: ['src/add.test.ts', 'pkg/sum_test.go', 'app/test_sum.py', 'tests/test_api.py'],
      sources: ['src/add.ts', 'README.md'],
    })
  })

  test('source globs narrow the source side; a file in neither is left alone', () => {
    const files = ['src/add.ts', 'docs/guide.md', 'src/add.test.ts']
    expect(classifyFiles(files, DEFAULT_TEST_GLOBS, ['src/**'])).toEqual({
      tests: ['src/add.test.ts'],
      sources: ['src/add.ts'],
    })
  })

  test('a file that is a test is never also a source', () => {
    expect(classifyFiles(['src/add.test.ts'], DEFAULT_TEST_GLOBS, ['src/**']).sources).toEqual([])
  })
})

describe('git output', () => {
  test('NUL-separated names, duplicates and blanks dropped', () => {
    expect(parseNulList('a.ts\0b c.ts\0\0a.ts\0')).toEqual(['a.ts', 'b c.ts'])
  })
})

describe('the test command', () => {
  test('splits on blanks and keeps quoted words whole', () => {
    expect(splitCommand('npm test --')).toEqual(['npm', 'test', '--'])
    expect(splitCommand(`pytest -k "not slow" -q`)).toEqual(['pytest', '-k', 'not slow', '-q'])
    expect(splitCommand(`  go   test  './...' `)).toEqual(['go', 'test', './...'])
    expect(splitCommand('')).toEqual([])
  })
})
