// sentry: wait outside the model. Polls watched PRs with gh on a timer and
// wakes the session only when something actionable happens.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { SentrySnapshot, SentryWatch } from '../types'
import {
  checkRunsArgv,
  describeGhFailure,
  describeSpawnFailure,
  parseJson,
  parsePrRef,
  prQueryArgv,
  readCheckRunsPage,
  readPullRequest,
  REPO_VIEW_ARGV,
} from './gh'
import { halfBlockRows, LEVEL_COLOR, LEVEL_LABEL, PICO, SIGNATURE, TOWER } from './pixels'
import { denyText, sleepPollShape } from './poll'
import type { CheckRun } from './truth'
import {
  buildSnapshot,
  isActionable,
  shortSha,
  statusLine,
  summaryLine,
  toastText,
  transitions,
  wakeLine,
  worstLevel,
} from './truth'

const PANE = 'sentry'
const TOOL = 'pr_state'
const MAX_THREAD_PAGES = 10
const MAX_CHECK_PAGES = 20
const GH_TIMEOUT_MS = 30_000

const watches = atom({ plugin: 'sentry', key: 'watches' } as const, [] as SentryWatch[])

type Gh = { stdout: string } | { error: string }
type Polled = { snapshot: SentrySnapshot } | { error: string }

let timer: Timer | null = null
let isPolling = false

function isLive(watch: SentryWatch): boolean {
  return watch.snapshot === null || watch.snapshot.state === 'OPEN'
}

function sameWatch(watch: SentryWatch, repo: string, number: number): boolean {
  return watch.repo === repo && watch.number === number
}

/** Runs gh; every failure (missing, timed out, unauthenticated, any non-zero exit) becomes `{ error }`. */
async function gh($: EngineInterface, argv: readonly string[]): Promise<Gh> {
  const startedAt = await $.clock.now()
  try {
    const ran = await $.process.run(argv, { timeoutMs: GH_TIMEOUT_MS })
    return ran.exitCode === 0 ? { stdout: ran.stdout } : { error: describeGhFailure(ran.stderr) }
  } catch (error) {
    const elapsedMs = (await $.clock.now()) - startedAt
    return { error: describeSpawnFailure(error instanceof Error ? error.message : String(error), elapsedMs, GH_TIMEOUT_MS) }
  }
}

async function sessionRepo($: EngineInterface): Promise<Gh> {
  const ran = await gh($, REPO_VIEW_ARGV)
  if ('error' in ran) return { error: `${ran.error} (or pass a PR URL)` }
  const repo = ran.stdout.trim()
  return repo === '' ? { error: 'gh found no GitHub repo here: pass a PR URL.' } : { stdout: repo }
}

/** Every check-run on the head SHA, 100 per page, or why they could not be read. */
async function checkRuns($: EngineInterface, repo: string, sha: string): Promise<{ runs: CheckRun[] } | { error: string }> {
  const runs: CheckRun[] = []
  for (let page = 1; page <= MAX_CHECK_PAGES; page += 1) {
    const ran = await gh($, checkRunsArgv(repo, sha, page))
    if ('error' in ran) return { error: ran.error }
    const read = readCheckRunsPage(parseJson(ran.stdout))
    if (read === null) return { error: 'unreadable check-runs output' }
    runs.push(...read.runs)
    if (read.runs.length < 100 || runs.length >= read.total) return { runs }
  }
  return { runs }
}

/** One full poll of one PR: state, unresolved threads (paged) and head check-runs (paged). */
async function pollPr($: EngineInterface, repo: string, number: number, previous: SentrySnapshot | null): Promise<Polled> {
  let after: string | null = null
  const unresolvedIds: string[] = []
  let first = null
  for (let page = 0; page < MAX_THREAD_PAGES; page += 1) {
    const ran = await gh($, prQueryArgv(repo, number, after))
    if ('error' in ran) return { error: ran.error }
    const read = readPullRequest(parseJson(ran.stdout))
    if ('error' in read) return { error: `PR #${number} in ${repo}: ${read.error}` }
    first = first ?? read.pr
    unresolvedIds.push(...read.unresolvedIds)
    after = read.nextCursor
    if (after === null) break
  }
  if (first === null) return { error: `PR #${number} in ${repo}: not found` }
  const ci = first.headRefOid === '' ? { runs: [] } : await checkRuns($, repo, first.headRefOid)
  return 'error' in ci
    ? { snapshot: buildSnapshot(repo, first, unresolvedIds, null, previous, ci.error) }
    : { snapshot: buildSnapshot(repo, first, unresolvedIds, ci.runs, previous) }
}

async function refreshStatus($: EngineInterface) {
  const list = await read($, watches)
  const snapshots = list.flatMap(watch => (watch.snapshot ? [watch.snapshot] : []))
  const error = list.find(watch => watch.error !== null)?.error ?? null
  $.ui.status(statusLine(snapshots, error))
}

/**
 * Polls one watch, records the result and reports what changed: a toast on
 * every transition, and the wake line when one is actionable. A poll whose
 * check-runs could not be read records the PR but keeps the error (ERR on the
 * status line, toasted once).
 */
async function pollAndRecord($: EngineInterface, watch: SentryWatch): Promise<string | null> {
  const polled = await pollPr($, watch.repo, watch.number, watch.snapshot)
  const checkedAt = await $.clock.now()
  const error = 'error' in polled ? polled.error : polled.snapshot.ciError === null ? null : `CI unknown: ${polled.snapshot.ciError}`
  const next: SentryWatch =
    'error' in polled
      ? { ...watch, error, checkedAt }
      : { ...watch, snapshot: polled.snapshot, error, checkedAt }
  await update($, watches, list => list.map(one => (sameWatch(one, watch.repo, watch.number) ? next : one)))

  if (error !== null && error !== watch.error) $.ui.toast(`SENTRY #${watch.number}: ${error}`)
  if ('error' in polled) return null
  const found = transitions(watch.snapshot, polled.snapshot)
  if (found.length === 0) return null
  $.ui.toast(toastText(polled.snapshot, found))
  return found.some(isActionable) ? wakeLine(polled.snapshot, found.filter(isActionable)) : null
}

/** The timer's work: poll every live watch, then wake once with every actionable line. */
async function tick($: EngineInterface, wake: string) {
  if (isPolling) return
  isPolling = true
  try {
    const list = (await read($, watches)).filter(isLive)
    if (list.length === 0) return
    const lines: string[] = []
    for (const watch of list) {
      const line = await pollAndRecord($, watch)
      if (line !== null) lines.push(line)
    }
    await refreshStatus($)
    if (wake === 'actionable' && lines.length > 0) await $.prompt.submit({ text: lines.join('\n') })
  } finally {
    isPolling = false
  }
}

async function watchCommand($: EngineInterface, argument: string): Promise<string> {
  const ref = parsePrRef(argument)
  if (ref === null) return `sentry: "${argument}" is not a PR. Use /watch 42, /watch owner/repo#42 or a PR URL.`
  let repo = ref.repo
  if (repo === null) {
    const found = await sessionRepo($)
    if ('error' in found) return `sentry: ${found.error}`
    repo = found.stdout
  }
  const existing = (await read($, watches)).find(watch => sameWatch(watch, repo, ref.number)) ?? null
  const polled = await pollPr($, repo, ref.number, existing?.snapshot ?? null)
  if ('error' in polled) return `sentry: not watching PR #${ref.number}: ${polled.error}`
  const checkedAt = await $.clock.now()
  const ciError = polled.snapshot.ciError
  const watch: SentryWatch = { repo, number: ref.number, snapshot: polled.snapshot, error: ciError === null ? null : `CI unknown: ${ciError}`, checkedAt }
  await update($, watches, list => [...list.filter(one => !sameWatch(one, repo, ref.number)), watch])
  await refreshStatus($)
  const note = polled.snapshot.state === 'OPEN' ? 'I will wake you when it needs you.' : 'It is already closed.'
  return `SENTRY ON WATCH: ${repo} ${summaryLine(polled.snapshot)}. ${note}`
}

async function removeWatch($: EngineInterface, repo: string, number: number) {
  await update($, watches, list => list.filter(watch => !sameWatch(watch, repo, number)))
  await refreshStatus($)
}

async function unwatchCommand($: EngineInterface, argument: string): Promise<string> {
  const ref = parsePrRef(argument)
  if (ref === null) return 'sentry: say which PR, e.g. /unwatch 42.'
  const list = await read($, watches)
  const isGone = (watch: SentryWatch) => watch.number === ref.number && (ref.repo === null || watch.repo === ref.repo)
  if (!list.some(isGone)) return `sentry: not watching PR #${ref.number}.`
  await update($, watches, all => all.filter(watch => !isGone(watch)))
  await refreshStatus($)
  return `sentry: stopped watching PR #${ref.number}.`
}

/** The `pr_state` tool: fresh truth for one PR or every watched one (records it; never wakes). */
async function prState($: EngineInterface, argument: unknown) {
  const wanted = argument === undefined || argument === null || argument === '' ? null : parsePrRef(String(argument))
  if (argument !== undefined && argument !== null && argument !== '' && wanted === null) {
    return { error: `"${String(argument)}" is not a PR number or URL.` }
  }
  const list = await read($, watches)
  let targets = wanted === null ? list : list.filter(watch => watch.number === wanted.number && (wanted.repo === null || watch.repo === wanted.repo))
  if (wanted !== null && targets.length === 0) {
    let repo = wanted.repo
    if (repo === null) {
      const found = await sessionRepo($)
      if ('error' in found) return { error: found.error }
      repo = found.stdout
    }
    const polled = await pollPr($, repo, wanted.number, null)
    if ('error' in polled) return { error: polled.error }
    return { prs: [{ summary: summaryLine(polled.snapshot), isWatched: false, ...polled.snapshot }] }
  }
  if (targets.length === 0) return { prs: [], note: 'No PRs are watched. The person adds one with /watch <pr>.' }
  for (const watch of targets) {
    if (isLive(watch)) await pollAndRecord($, watch)
  }
  await refreshStatus($)
  targets = (await read($, watches)).filter(watch => targets.some(one => sameWatch(one, watch.repo, watch.number)))
  return {
    prs: targets.map(watch =>
      watch.snapshot
        ? { summary: summaryLine(watch.snapshot), isWatched: true, error: watch.error, ...watch.snapshot }
        : { repo: watch.repo, number: watch.number, isWatched: true, error: watch.error },
    ),
  }
}

export const register: Register = (on, options) => {
  const intervalMs = Math.max(15, Number(options.intervalSeconds ?? 60)) * 1000
  const wake = String(options.wake ?? 'actionable')

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'watch', description: 'sentry: watch a PR (number or URL), or open the pane', argumentHint: '[pr]' })
    await $.command.register({ name: 'unwatch', description: 'sentry: stop watching a PR', argumentHint: '<pr>' })
    await $.tool.register({
      name: TOOL,
      description:
        'The truth about a pull request, read by sentry with gh: head SHA, CI on that SHA (no check-runs yet = pending, never green), review decision, unresolved threads, merge queue, merged/closed. Call this instead of hand-rolling gh, sleep or watch loops. Leave pr out for every watched PR.',
      inputSchema: {
        type: 'object',
        properties: { pr: { type: ['number', 'string'], description: 'PR number, owner/repo#n or PR URL' } },
      },
    })
    timer?.cancel()
    timer = $.clock.every(intervalMs, () => {
      void tick($, wake)
    })
    await refreshStatus($)
    return next(e)
  })

  on('command.run', { command: 'watch' }, async ($, e) => {
    const argument = (e.args ?? '').trim()
    if (argument === '') {
      await $.ui.open({ id: PANE, title: 'SENTRY' })
      const list = await read($, watches)
      return { text: list.length === 0 ? 'SENTRY: no PRs watched. /watch <pr> to insert coin.' : `SENTRY: watching ${list.map(watch => `#${watch.number}`).join(', ')}.` }
    }
    return { text: await watchCommand($, argument) }
  })

  on('command.run', { command: 'unwatch' }, async ($, e) => ({ text: await unwatchCommand($, (e.args ?? '').trim()) }))

  on('tool.call', { tool: 'mcp__sentry__pr_state' }, async ($, e) => {
    const input = e as unknown as { pr?: unknown }
    return { result: await prState($, input.pr) }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const shape = sleepPollShape(e.command)
    if (shape === null) return next(e)
    const live = (await read($, watches)).filter(isLive)
    if (live.length === 0) return next(e)
    return { deny: denyText(live.map(watch => watch.number)) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, watches)
    const snapshots = list.flatMap(watch => (watch.snapshot ? [watch.snapshot] : []))
    const level = worstLevel(snapshots, list.some(watch => watch.error !== null))
    const beacon = LEVEL_COLOR[level]
    const width = Math.max(20, e.props.bodyColumns - 10)

    const light = (label: string, color: string) => (
      <Box flexDirection="row" marginRight={1}>
        <Text color={PICO.lightGrey}>{label} </Text>
        <Text color={color}>●</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Box key="tower" flexDirection="column" marginRight={2}>
            {halfBlockRows(TOWER, beacon).map(runs => (
              <Box flexDirection="row">
                {runs.map(run => (
                  <Text color={run.color} backgroundColor={run.backgroundColor}>
                    {run.text}
                  </Text>
                ))}
              </Box>
            ))}
          </Box>
          <Box flexDirection="column">
            <Text bold color={SIGNATURE}>
              S E N T R Y
            </Text>
            <Text bold color={beacon}>
              ★ {LEVEL_LABEL[level]}
            </Text>
            <Text color={PICO.lightGrey}>WATCHING {list.length}</Text>
            <Text dimColor>POLL {Math.round(intervalMs / 1000)}S / WAKE {wake.toUpperCase()}</Text>
          </Box>
        </Box>
        {list.length === 0 && (
          <Box key="empty" marginTop={1}>
            <Text color={PICO.lightGrey}>NO PRS ON WATCH. /watch 42 TO INSERT COIN</Text>
          </Box>
        )}
        {list.map(watch => {
          const snapshot = watch.snapshot
          const ciColor = !snapshot
            ? PICO.darkGrey
            : snapshot.ci === 'green'
              ? PICO.lime
              : snapshot.ci === 'failed'
                ? PICO.red
                : snapshot.ci === 'running'
                  ? PICO.yellow
                  : PICO.darkGrey
          const reviewColor =
            snapshot?.reviewDecision === 'APPROVED'
              ? PICO.lime
              : snapshot?.reviewDecision === 'CHANGES_REQUESTED'
                ? PICO.red
                : snapshot?.reviewDecision === 'REVIEW_REQUIRED'
                  ? PICO.yellow
                  : PICO.darkGrey
          const threadColor = !snapshot ? PICO.darkGrey : snapshot.openThreads > 0 ? PICO.orange : PICO.lime
          const queueColor = snapshot?.isInMergeQueue ? PICO.blue : PICO.darkGrey
          const mergedColor =
            snapshot?.state === 'MERGED' ? PICO.lime : snapshot?.state === 'CLOSED' ? PICO.red : PICO.darkGrey
          const title = snapshot ? snapshot.title : watch.repo
          return (
            <Box key={`pr-${watch.number}`} flexDirection="column" marginTop={1}>
              <Box flexDirection="row">
                <Text bold color={SIGNATURE}>
                  #{watch.number}{' '}
                </Text>
                <Text wrap="truncate-end">{title.length > width ? `${title.slice(0, width - 1)}~` : title}</Text>
              </Box>
              <Box flexDirection="row">
                {light('CI', ciColor)}
                {light('REVIEW', reviewColor)}
                {light(`THREADS${snapshot && snapshot.openThreads > 0 ? ` ${snapshot.openThreads}` : ''}`, threadColor)}
                {light('QUEUE', queueColor)}
                {light('MERGED', mergedColor)}
              </Box>
              <Box flexDirection="row">
                <Text dimColor>
                  {snapshot ? `${shortSha(snapshot.headSha)} ${snapshot.ci.toUpperCase()}` : 'NO DATA YET'}
                  {snapshot && snapshot.failedChecks.length > 0 ? ` (${snapshot.failedChecks.slice(0, 3).join(', ')})` : ''}{' '}
                </Text>
                <Button
                  key={`unwatch-${watch.number}`}
                  label="UNWATCH"
                  dimColor
                  onPress={() => removeWatch($, watch.repo, watch.number)}
                />
              </Box>
              {watch.error !== null && (
                <Text color={PICO.red}>{watch.error}</Text>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
