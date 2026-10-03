// The proof: measure the change against the merge base, put the changed
// sources back to their base versions, require the changed tests to fail,
// restore the sources (verified by hash), require them to pass.
//
// It never uses git stash or git checkout: copies go to the temp dir with cp,
// base versions are written from `git show`, and the restore runs in a
// finally block whatever happened in between. A lock folder in the git dir
// keeps a second proof (from this session or another) off the same tree, and
// an interrupt stops waiting on the tests and restores at once.

import type { ProvePhase, ProveProof, ProveRun, ProveVerdict } from '../types'
import { classifyFiles, parseNulList } from './files'

export type RunOutput = { exitCode: number; stdout: string; stderr: string }

/** What the proof needs from the host; register.tsx builds it from `$`. Every call may reject. */
export type Host = {
  run: (argv: readonly string[], init?: { cwd?: string; timeoutMs?: number }) => Promise<RunOutput>
  write: (path: string, text: string) => Promise<void>
  exists: (path: string) => Promise<boolean>
  /** Reports progress while the proof runs; never called with idle (the caller owns that). */
  onPhase: (phase: Exclude<ProvePhase, 'idle'>) => Promise<void>
  /** Aborts when the person interrupts or the dispatch goes on without the proof. */
  signal?: AbortSignal
}

export type ProveSettings = {
  /** The test command as argv; the changed test files are appended. */
  testCommand: readonly string[]
  testGlobs: readonly string[]
  sourceGlobs: readonly string[]
  /** The ref to measure against; empty means detect it. */
  base: string
  timeoutMs: number
  tmpDir: string
}

/** The change, measured: where the repo is, what changed, and its fingerprint. */
export type Survey = {
  root: string
  /** The absolute git dir (per worktree), where the lock lives. */
  gitDir: string
  baseSha: string
  sources: string[]
  tests: string[]
  fingerprint: string
}

const GIT_TIMEOUT_MS = 30_000
const FALLBACK_BASES = ['origin/main', 'origin/master', 'main', 'master'] as const

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const firstLine = (text: string): string => text.trim().split('\n')[0] ?? ''

/** FNV-1a, 32 bit, as hex: enough to tell one state of a change from another. */
export const fingerprintOf = (text: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
}

/** The last few lines a test run printed, for the reply and the deny text. */
export const tailOf = (output: RunOutput, lines = 4): string =>
  `${output.stdout}\n${output.stderr}`
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '')
    .slice(-lines)
    .join('\n')
    .slice(-400)

export const emptyProof = (verdict: ProveVerdict, detail: string, at: number): ProveProof => ({
  verdict,
  base: '',
  sources: [],
  tests: [],
  without: null,
  with: null,
  detail,
  copiesDir: '',
  fingerprint: '',
  at,
})

class Stop extends Error {}

/** The proof was interrupted; whatever it had changed is restored before it says so. */
class Interrupted extends Error {}

export const INTERRUPTED = 'interrupted: the proof stopped early and your files were restored'

export const LOCK_NAME = 'prove-it.lock'

/** `work`, or a rejection as soon as `signal` aborts (the work itself runs on: process.run cannot be cancelled). */
const untilAborted = async <T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> => {
  if (signal === undefined) return work
  if (signal.aborted) throw new Interrupted(INTERRUPTED)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Interrupted(INTERRUPTED))
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

const git = async (host: Host, cwd: string, args: readonly string[]): Promise<RunOutput> =>
  host.run(['git', ...args], { cwd, timeoutMs: GIT_TIMEOUT_MS })

/** git that must succeed: its stdout, or a Stop with git's own first line. */
const gitOut = async (host: Host, cwd: string, args: readonly string[], what: string): Promise<string> => {
  const out = await git(host, cwd, args).catch(error => {
    throw new Stop(`${what}: ${errorText(error)}`)
  })
  if (out.exitCode !== 0) throw new Stop(`${what}: ${firstLine(out.stderr) || `git exited ${out.exitCode}`}`)
  return out.stdout
}

const findBaseRef = async (host: Host, root: string, configured: string): Promise<string> => {
  if (configured !== '') return configured
  const remoteHead = await git(host, root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(() => null)
  const named = remoteHead?.exitCode === 0 ? remoteHead.stdout.trim() : ''
  if (named !== '') return named
  for (const ref of FALLBACK_BASES) {
    const found = await git(host, root, ['rev-parse', '--verify', '--quiet', ref]).catch(() => null)
    if (found?.exitCode === 0) return ref
  }
  throw new Stop('no base branch found (tried origin HEAD, origin/main, origin/master, main, master); set the base option')
}

const hashOf = async (host: Host, root: string, path: string): Promise<string> =>
  (await gitOut(host, root, ['hash-object', '--no-filters', '--', path], `hash ${path}`)).trim()

/** Measures the change: the repo root, the merge base, the changed tests and sources, a fingerprint. */
export const survey = async (host: Host, cwd: string, settings: ProveSettings, at: number): Promise<Survey | ProveProof> => {
  try {
    const root = (await gitOut(host, cwd, ['rev-parse', '--show-toplevel'], 'not a git repository')).trim()
    const gitDir = (await gitOut(host, root, ['rev-parse', '--absolute-git-dir'], 'no git dir')).trim()
    const baseRef = await findBaseRef(host, root, settings.base)
    const baseSha = (await gitOut(host, root, ['merge-base', 'HEAD', baseRef], `no merge base with ${baseRef}`)).trim()
    const head = (await gitOut(host, root, ['rev-parse', 'HEAD'], 'no HEAD commit')).trim()
    // --no-renames: a renamed source must show its old path too, so the run without the fix brings it back.
    const tracked = parseNulList(
      await gitOut(host, root, ['diff', '--no-renames', '--name-only', '-z', baseSha], 'git diff failed'),
    )
    const untracked = parseNulList(
      await gitOut(host, root, ['ls-files', '--others', '--exclude-standard', '-z'], 'git ls-files failed'),
    )

    const { sources } = classifyFiles(tracked, settings.testGlobs, settings.sourceGlobs)
    const changedTests = classifyFiles([...new Set([...tracked, ...untracked])], settings.testGlobs, []).tests
    const tests: string[] = []
    for (const path of changedTests) if (await host.exists(`${root}/${path}`)) tests.push(path)

    const diff = await gitOut(host, root, ['diff', '--no-renames', '--no-ext-diff', '--binary', baseSha], 'git diff failed')
    const untrackedTests = tests.filter(path => untracked.includes(path))
    const untrackedHashes: string[] = []
    for (const path of untrackedTests) untrackedHashes.push(`${path} ${await hashOf(host, root, `${root}/${path}`)}`)
    const fingerprint = fingerprintOf([head, baseSha, diff, ...untrackedHashes, settings.testCommand.join(' ')].join('\n'))

    return { root, gitDir, baseSha, sources, tests, fingerprint }
  } catch (error) {
    if (error instanceof Stop) return emptyProof('error', error.message, at)
    return emptyProof('error', errorText(error), at)
  }
}

type Aside = { path: string; absolute: string; copy: string; hash: string | null; baseText: string | null }

const dirOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/'))) || '/'

/** Copies every changed source aside, checking each copy, and reads its base version. Touches nothing in the tree. */
const putAside = async (host: Host, survey: Survey, copiesDir: string): Promise<Aside[]> => {
  const asides: Aside[] = []
  for (const path of survey.sources) {
    const absolute = `${survey.root}/${path}`
    const copy = `${copiesDir}/${path}`
    let hash: string | null = null
    if (await host.exists(absolute)) {
      hash = await hashOf(host, survey.root, absolute)
      await gitlessRun(host, ['mkdir', '-p', dirOf(copy)], `could not make ${dirOf(copy)}`)
      await gitlessRun(host, ['cp', '-p', absolute, copy], `could not copy ${path} aside`)
      const copied = await hashOf(host, survey.root, copy).catch(() => '')
      if (copied !== hash) throw new Stop(`the copy of ${path} in ${copiesDir} does not match the original; nothing was changed`)
    }
    const shown = await git(host, survey.root, ['show', `${survey.baseSha}:${path}`]).catch(error => {
      throw new Stop(`git show ${path}: ${errorText(error)}`)
    })
    asides.push({ path, absolute, copy, hash, baseText: shown.exitCode === 0 ? shown.stdout : null })
  }

  return asides
}

const gitlessRun = async (host: Host, argv: readonly string[], what: string): Promise<void> => {
  const out = await host.run(argv, { timeoutMs: GIT_TIMEOUT_MS }).catch(error => {
    throw new Stop(`${what}: ${errorText(error)}`)
  })
  if (out.exitCode !== 0) throw new Stop(`${what}: ${firstLine(out.stderr) || `exit ${out.exitCode}`}`)
}

/** Puts each source back to its base version: written from git show, or removed when the base had none. */
const revert = async (host: Host, asides: readonly Aside[]): Promise<void> => {
  for (const aside of asides) {
    if (aside.baseText !== null) await host.write(aside.absolute, aside.baseText)
    else if (aside.hash !== null) await gitlessRun(host, ['rm', '-f', aside.absolute], `could not remove ${aside.path}`)
  }
}

/** Copies every source back (or removes what the fix had deleted) and verifies each; the paths that failed. */
const restore = async (host: Host, root: string, asides: readonly Aside[]): Promise<string[]> => {
  const failures: string[] = []
  for (const aside of asides) {
    try {
      if (aside.hash !== null) {
        await gitlessRun(host, ['cp', '-p', aside.copy, aside.absolute], `could not restore ${aside.path}`)
        if ((await hashOf(host, root, aside.absolute)) !== aside.hash) failures.push(aside.path)
      } else {
        if (await host.exists(aside.absolute)) {
          await gitlessRun(host, ['rm', '-f', aside.absolute], `could not remove ${aside.path}`)
        }
        if (await host.exists(aside.absolute)) failures.push(aside.path)
      }
    } catch {
      failures.push(aside.path)
    }
  }

  return failures
}

const runTests = async (host: Host, survey: Survey, settings: ProveSettings): Promise<ProveRun> => {
  const run = host.run([...settings.testCommand, ...survey.tests], { cwd: survey.root, timeoutMs: settings.timeoutMs })
  const out = await untilAborted(run, host.signal)
  return { exitCode: out.exitCode, tail: tailOf(out) }
}

/** Takes the repository's proof lock (mkdir is atomic), or stops: another proof is reverting this tree. */
const takeLock = async (host: Host, lock: string): Promise<void> => {
  const out = await host.run(['mkdir', lock], { timeoutMs: GIT_TIMEOUT_MS }).catch(error => {
    throw new Stop(`could not take the lock ${lock}: ${errorText(error)}`)
  })
  if (out.exitCode !== 0) {
    throw new Stop(
      `a proof is already running in this repository (${lock} exists). If none is, a proof was cut off: ` +
        'your versions are in the newest $TMPDIR/prove-it-<time>/ folder; put them back, then remove the lock folder',
    )
  }
}

/** Runs the proof on a survey: fail without the fix, restore and verify, pass with it. */
export const runProof = async (host: Host, survey: Survey, settings: ProveSettings, at: number): Promise<ProveProof> => {
  const proof: ProveProof = {
    ...emptyProof('error', '', at),
    base: survey.baseSha.slice(0, 7),
    sources: survey.sources,
    tests: survey.tests,
    fingerprint: survey.fingerprint,
  }
  if (survey.sources.length === 0 && survey.tests.length === 0) return { ...proof, verdict: 'nothing' }
  if (survey.tests.length === 0) return { ...proof, verdict: 'no-tests' }
  if (settings.testCommand.length === 0) {
    return { ...proof, detail: 'no test command: set the testCommand option (e.g. "npm test --" or "pytest")' }
  }

  if (host.signal?.aborted) return { ...proof, detail: INTERRUPTED }

  let lock = ''
  try {
    if (survey.sources.length === 0) {
      await host.onPhase('with')
      const only = await runTests(host, survey, settings)
      return { ...proof, with: only, verdict: only.exitCode === 0 ? 'no-source' : 'broken' }
    }

    await takeLock(host, `${survey.gitDir}/${LOCK_NAME}`)
    lock = `${survey.gitDir}/${LOCK_NAME}`
    const copiesDir = `${settings.tmpDir.replace(/\/+$/, '')}/prove-it-${at}`
    proof.copiesDir = copiesDir
    const asides = await putAside(host, survey, copiesDir)

    // Every way out of the run without the fix lands here, so the restore below always runs.
    let withoutError: unknown = null
    try {
      await host.onPhase('without')
      if (host.signal?.aborted) throw new Interrupted(INTERRUPTED)
      await revert(host, asides)
      proof.without = await runTests(host, survey, settings)
    } catch (error) {
      withoutError = error
    }
    const failures = await restore(host, survey.root, asides)
    if (failures.length > 0) {
      return {
        ...proof,
        verdict: 'restore-failed',
        detail: `restore did not match for ${failures.join(', ')}; your copies are in ${copiesDir}`,
      }
    }
    if (withoutError instanceof Interrupted || host.signal?.aborted) return { ...proof, without: null, detail: INTERRUPTED }
    if (withoutError !== null) return { ...proof, detail: `the run without the fix failed to run: ${errorText(withoutError)}` }

    await host.onPhase('with')
    proof.with = await runTests(host, survey, settings)
    const verdict: ProveVerdict =
      proof.with.exitCode !== 0 ? 'broken' : (proof.without?.exitCode ?? 0) !== 0 ? 'proven' : 'not-proven'
    return { ...proof, verdict }
  } catch (error) {
    return { ...proof, detail: errorText(error) }
  } finally {
    if (lock !== '') await host.run(['rmdir', lock], { timeoutMs: GIT_TIMEOUT_MS }).catch(() => undefined)
  }
}

/** Survey then proof, in one go. */
export const prove = async (host: Host, cwd: string, settings: ProveSettings, at: number): Promise<ProveProof> => {
  const surveyed = await survey(host, cwd, settings, at)
  return 'verdict' in surveyed ? surveyed : runProof(host, surveyed, settings, at)
}
