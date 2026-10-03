import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_TEST_GLOBS } from '../hooks/files'
import { INTERRUPTED, prove } from '../hooks/prove'
import type { Host, ProveSettings } from '../hooks/prove'
import { BASE_SHA, BUGGY, FIXED, LOCK, ROOT, TEST, TEST_COMMAND, TMP, makeRepo, runIn } from './repo'
import type { Repo } from './repo'

const SETTINGS: ProveSettings = {
  testCommand: TEST_COMMAND,
  testGlobs: [...DEFAULT_TEST_GLOBS],
  sourceGlobs: [],
  base: '',
  timeoutMs: 60_000,
  tmpDir: TMP,
}

const hostOf = (repo: Repo, phases: string[] = []): Host => ({
  run: async argv => runIn(repo, argv),
  write: async (path, text) => {
    repo.files.set(path, text)
  },
  exists: async path => repo.files.has(path),
  onPhase: async phase => {
    phases.push(phase)
  },
})

const run = (repo: Repo, settings: Partial<ProveSettings> = {}, phases: string[] = []) =>
  prove(hostOf(repo, phases), ROOT, { ...SETTINGS, ...settings }, 1_000)

const neverTouched = (repo: Repo) => repo.ran.every(argv => !argv.includes('stash') && !argv.includes('checkout') && !argv.includes('restore'))

describe('verdicts', () => {
  test('PROVEN: the changed test fails with the source at the base and passes with the fix', async () => {
    const repo = makeRepo()
    const phases: string[] = []
    const proof = await run(repo, {}, phases)
    expect(proof.verdict).toBe('proven')
    expect(proof.sources).toEqual(['src/add.ts'])
    expect(proof.tests).toEqual(['src/add.test.ts'])
    expect(proof.without?.exitCode).toBe(1)
    expect(proof.with?.exitCode).toBe(0)
    expect(proof.base).toBe(BASE_SHA.slice(0, 7))
    // The caller owns the idle phase (its claim); the proof only reports progress.
    expect(phases).toEqual(['without', 'with'])

    expect(repo.treeAtTestRun[0]?.get(`${ROOT}/src/add.ts`)).toBe(BUGGY)
    expect(repo.treeAtTestRun[1]?.get(`${ROOT}/src/add.ts`)).toBe(FIXED)
    expect(repo.files.get(`${ROOT}/src/add.ts`)).toBe(FIXED)
    expect(repo.ran.filter(argv => argv[0] === 'npm')).toEqual([
      [...TEST_COMMAND, 'src/add.test.ts'],
      [...TEST_COMMAND, 'src/add.test.ts'],
    ])
  })

  test('NOT PROVEN: the test passes without the fix, so it does not test it', async () => {
    const repo = makeRepo({ judge: () => 0 })
    const proof = await run(repo)
    expect(proof.verdict).toBe('not-proven')
    expect(repo.files.get(`${ROOT}/src/add.ts`)).toBe(FIXED)
  })

  test('BROKEN: the test fails with the fix', async () => {
    const repo = makeRepo({ judge: () => 1 })
    const proof = await run(repo)
    expect(proof.verdict).toBe('broken')
    expect(proof.with?.tail).toContain('1 failing')
    expect(repo.files.get(`${ROOT}/src/add.ts`)).toBe(FIXED)
  })

  test('no test changed is reported and nothing runs', async () => {
    const repo = makeRepo()
    repo.files.delete(`${ROOT}/src/add.test.ts`)
    const proof = await run(repo)
    expect(proof.verdict).toBe('no-tests')
    expect(proof.sources).toEqual(['src/add.ts'])
    expect(repo.testRuns).toBe(0)
  })

  test('no change against the base is nothing to prove', async () => {
    const repo = makeRepo()
    repo.files.set(`${ROOT}/src/add.ts`, BUGGY)
    repo.files.delete(`${ROOT}/src/add.test.ts`)
    expect((await run(repo)).verdict).toBe('nothing')
  })

  test('only tests changed: one run, a pass is no-source and a failure is broken', async () => {
    const passing = makeRepo({ judge: () => 0 })
    passing.files.set(`${ROOT}/src/add.ts`, BUGGY)
    expect((await run(passing)).verdict).toBe('no-source')
    expect(passing.testRuns).toBe(1)

    const failing = makeRepo({ judge: () => 1 })
    failing.files.set(`${ROOT}/src/add.ts`, BUGGY)
    expect((await run(failing)).verdict).toBe('broken')
  })

  test('an untracked new test counts; untracked files are never treated as source', async () => {
    const repo = makeRepo()
    repo.untracked.add('src/add.test.ts')
    repo.files.set(`${ROOT}/scratch.txt`, 'notes')
    repo.untracked.add('scratch.txt')
    const proof = await run(repo)
    expect(proof.tests).toEqual(['src/add.test.ts'])
    expect(proof.sources).toEqual(['src/add.ts'])
    expect(proof.verdict).toBe('proven')
  })

  test('a deleted test file is not passed to the test command', async () => {
    const repo = makeRepo()
    repo.base.set('src/old.test.ts', TEST)
    await run(repo)
    expect(repo.ran.filter(argv => argv[0] === 'npm').every(argv => !argv.includes('src/old.test.ts'))).toBe(true)
  })
})

describe('reverting and restoring', () => {
  test('copies go to the temp dir, base versions come from git show, never stash or checkout', async () => {
    const repo = makeRepo()
    const proof = await run(repo)
    expect(proof.copiesDir).toBe(`${TMP}/prove-it-1000`)
    expect(repo.files.get(`${TMP}/prove-it-1000/src/add.ts`)).toBe(FIXED)
    expect(repo.ran).toContainEqual(['git', 'show', `${BASE_SHA}:src/add.ts`])
    expect(neverTouched(repo)).toBe(true)
  })

  test('a source file the fix added is removed for the run without it, then put back', async () => {
    const repo = makeRepo({ judge: files => (files.has(`${ROOT}/src/helper.ts`) ? 0 : 1) })
    repo.files.set(`${ROOT}/src/helper.ts`, 'export const helper = 1\n')
    const proof = await run(repo)
    expect(proof.verdict).toBe('proven')
    expect(repo.treeAtTestRun[0]?.has(`${ROOT}/src/helper.ts`)).toBe(false)
    expect(repo.files.get(`${ROOT}/src/helper.ts`)).toBe('export const helper = 1\n')
  })

  test('a source file the fix deleted is brought back for the run without it, then deleted again', async () => {
    const repo = makeRepo()
    repo.base.set('src/legacy.ts', 'legacy\n')
    const proof = await run(repo)
    expect(proof.sources).toContain('src/legacy.ts')
    expect(repo.treeAtTestRun[0]?.get(`${ROOT}/src/legacy.ts`)).toBe('legacy\n')
    expect(repo.files.has(`${ROOT}/src/legacy.ts`)).toBe(false)
    expect(proof.verdict).toBe('proven')
  })

  test('the restore happens and is verified even when the test command cannot start', async () => {
    const repo = makeRepo({ failToStartOnRun: 1 })
    const proof = await run(repo)
    expect(proof.verdict).toBe('error')
    expect(proof.detail).toContain('spawn npm ENOENT')
    expect(repo.files.get(`${ROOT}/src/add.ts`)).toBe(FIXED)
    const hashes = repo.ran.filter(argv => argv[1] === 'hash-object' && argv.at(-1) === `${ROOT}/src/add.ts`)
    expect(hashes.length).toBeGreaterThanOrEqual(2)
  })

  test('a restore whose hash does not match stops and says where the copies are', async () => {
    const repo = makeRepo({ corruptRestore: 'garbage' })
    const proof = await run(repo)
    expect(proof.verdict).toBe('restore-failed')
    expect(proof.detail).toContain(`${TMP}/prove-it-1000`)
    expect(proof.detail).toContain('src/add.ts')
    expect(repo.testRuns).toBe(1)
    expect(repo.files.get(`${TMP}/prove-it-1000/src/add.ts`)).toBe(FIXED)
  })

  test('a copy that does not match the original stops before anything is touched', async () => {
    const repo = makeRepo()
    const host = hostOf(repo)
    const proof = await prove(
      {
        ...host,
        run: async argv => {
          const out = runIn(repo, argv)
          if (argv[0] === 'cp') repo.files.set(argv.at(-1) as string, 'half a file')
          return out
        },
      },
      ROOT,
      SETTINGS,
      1_000,
    )
    expect(proof.verdict).toBe('error')
    expect(proof.detail).toMatch(/copy/i)
    expect(repo.testRuns).toBe(0)
    expect(repo.files.get(`${ROOT}/src/add.ts`)).toBe(FIXED)
  })
})

describe('errors', () => {
  test('outside a git repository is an error, nothing runs', async () => {
    const repo = makeRepo({ isNotARepo: true })
    const proof = await run(repo)
    expect(proof.verdict).toBe('error')
    expect(proof.detail).toMatch(/not a git repository/)
    expect(repo.testRuns).toBe(0)
  })

  test('a base with no merge base is an error that names the base', async () => {
    const proof = await run(makeRepo(), { base: 'origin/nope' })
    expect(proof.verdict).toBe('error')
    expect(proof.detail).toContain('origin/nope')
  })

  test('no test command configured is an error that says how to set it', async () => {
    const repo = makeRepo()
    const proof = await run(repo, { testCommand: [] })
    expect(proof.verdict).toBe('error')
    expect(proof.detail).toContain('testCommand')
    expect(repo.testRuns).toBe(0)
  })
})

describe('fingerprint', () => {
  test('the same change gives the same fingerprint; another edit changes it', async () => {
    const repo = makeRepo()
    const first = await run(repo)
    const second = await run(repo)
    expect(second.fingerprint).toBe(first.fingerprint)
    repo.files.set(`${ROOT}/src/add.ts`, `${FIXED}// more\n`)
    expect((await run(repo)).fingerprint).not.toBe(first.fingerprint)
  })

  test('an edit to an untracked test changes it too', async () => {
    const repo = makeRepo()
    repo.untracked.add('src/add.test.ts')
    const first = await run(repo)
    repo.files.set(`${ROOT}/src/add.test.ts`, `${TEST}// another case\n`)
    expect((await run(repo)).fingerprint).not.toBe(first.fingerprint)
  })
})

describe('renames', () => {
  const MODULE = 'export const one = 1\n'
  const importerOf = (name: string) => `import { one } from './${name}'\n`
  /** The test passes when the module c.ts imports exists: a pure rename changes nothing it checks. */
  const renamed = () =>
    makeRepo({
      files: new Map([
        [`${ROOT}/src/b.ts`, MODULE],
        [`${ROOT}/src/c.ts`, importerOf('b')],
        [`${ROOT}/src/c.test.ts`, TEST],
      ]),
      base: new Map([
        ['src/a.ts', MODULE],
        ['src/c.ts', importerOf('a')],
      ]),
      judge: files => {
        const name = /from '\.\/(\w+)'/.exec(files.get(`${ROOT}/src/c.ts`) ?? '')?.[1] ?? ''
        return files.has(`${ROOT}/src/${name}.ts`) ? 0 : 1
      },
    })

  test('a renamed source brings its old path back for the run without the fix, so a pure rename is NOT PROVEN', async () => {
    const repo = renamed()
    const proof = await run(repo)
    expect(proof.sources).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
    expect(repo.treeAtTestRun[0]?.get(`${ROOT}/src/a.ts`)).toBe(MODULE)
    expect(repo.treeAtTestRun[0]?.has(`${ROOT}/src/b.ts`)).toBe(false)
    expect(proof.verdict).toBe('not-proven')
    expect(repo.files.has(`${ROOT}/src/a.ts`)).toBe(false)
    expect(repo.files.get(`${ROOT}/src/b.ts`)).toBe(MODULE)
    expect(repo.files.get(`${ROOT}/src/c.ts`)).toBe(importerOf('b'))
  })

  test('both diffs ask git not to fold renames', async () => {
    const repo = renamed()
    await run(repo)
    const diffs = repo.ran.filter(argv => argv[1] === 'diff')
    expect(diffs.length).toBe(2)
    expect(diffs.every(argv => argv.includes('--no-renames'))).toBe(true)
  })
})

describe('one proof per repository', () => {
  test('the lock is taken in the git dir before anything is touched and released after', async () => {
    const repo = makeRepo()
    const proof = await run(repo)
    expect(proof.verdict).toBe('proven')
    const mkdir = repo.ran.findIndex(argv => argv[0] === 'mkdir' && argv[1] === LOCK)
    const firstCopy = repo.ran.findIndex(argv => argv[0] === 'cp')
    expect(mkdir).toBeGreaterThan(-1)
    expect(mkdir).toBeLessThan(firstCopy)
    expect(repo.ran.at(-1)).toEqual(['rmdir', LOCK])
    expect(repo.dirs.has(LOCK)).toBe(false)
  })

  test('another proof holding the lock stops this one before it touches anything, and its lock stays', async () => {
    const repo = makeRepo()
    repo.dirs.add(LOCK)
    const proof = await run(repo)
    expect(proof.verdict).toBe('error')
    expect(proof.detail).toContain('already running in this repository')
    expect(proof.detail).toContain(LOCK)
    expect(repo.testRuns).toBe(0)
    expect(repo.ran.some(argv => argv[0] === 'cp' || argv[0] === 'rmdir')).toBe(false)
    expect(repo.files.get(`${ROOT}/src/add.ts`)).toBe(FIXED)
    expect(repo.dirs.has(LOCK)).toBe(true)
  })

  test('the lock is released when the test command cannot start', async () => {
    const repo = makeRepo({ failToStartOnRun: 1 })
    expect((await run(repo)).verdict).toBe('error')
    expect(repo.dirs.has(LOCK)).toBe(false)
  })
})

describe('interrupts', () => {
  test('an abort during the run without the fix restores at once, without waiting for the tests', async () => {
    const repo = makeRepo()
    const stop = new AbortController()
    const host: Host = {
      ...hostOf(repo),
      run: async argv => {
        if (argv[0] !== 'npm') return runIn(repo, argv)
        runIn(repo, argv)
        stop.abort()
        return new Promise(() => undefined)
      },
      signal: stop.signal,
    }
    const proof = await prove(host, ROOT, SETTINGS, 1_000)
    expect(repo.treeAtTestRun[0]?.get(`${ROOT}/src/add.ts`)).toBe(BUGGY)
    expect(proof.verdict).toBe('error')
    expect(proof.detail).toBe(INTERRUPTED)
    expect(repo.files.get(`${ROOT}/src/add.ts`)).toBe(FIXED)
    expect(repo.testRuns).toBe(1)
    expect(repo.dirs.has(LOCK)).toBe(false)
  })

  test('an abort before the proof starts touches nothing', async () => {
    const repo = makeRepo()
    const stop = new AbortController()
    stop.abort()
    const proof = await prove({ ...hostOf(repo), signal: stop.signal }, ROOT, SETTINGS, 1_000)
    expect(proof.detail).toBe(INTERRUPTED)
    expect(repo.testRuns).toBe(0)
    expect(repo.ran.some(argv => argv[0] === 'cp' || argv[0] === 'mkdir')).toBe(false)
  })
})
