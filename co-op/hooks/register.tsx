import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CoopFinding, CoopOutcome, CoopRun } from '../types'
import { PALETTE, TWO_PLAYERS, pixelRows } from './pixels'
import {
  baseFlagOf,
  buildReviewPrompt,
  hashText,
  isBlocking,
  isPrCreate,
  leadingCdOf,
  parseReview,
  pickReviewerModel,
  severityCounts,
  splitArgv,
  truncateDiff,
} from './review'
import type { Review } from './review'
import { contextText, countsText, denyText, findingLine, statusText } from './text'

type Engine = EngineInterface

const PANE = 'co-op'

const LAST = { plugin: 'co-op', key: 'last' } as const
const lastAtom = atom(LAST, null)
const SKIP_NEXT = { plugin: 'co-op', key: 'skipNext' } as const
const skipNextAtom = atom(SKIP_NEXT, false)
const IS_REVIEWING = { plugin: 'co-op', key: 'isReviewing' } as const
const isReviewingAtom = atom(IS_REVIEWING, false)
const IS_BAND_HIDDEN = { plugin: 'co-op', key: 'isBandHidden' } as const
const isBandHiddenAtom = atom(IS_BAND_HIDDEN, false)

const USAGE = [
  'usage: /coop          review this branch now and open the 2P REVIEW pane',
  '       /coop skip     let the next gh pr create through unreviewed',
  '       /coop unskip   take that back',
  '       /coop view     open the pane with the last review',
].join('\n')

const CANCELLED = 'CO-OP: review cancelled; gh pr create did not run.'

/** Outcomes whose verdict may be reused when the same diff comes back. */
const REUSABLE: readonly CoopOutcome[] = ['pass', 'flagged', 'blocked']

const VERDICT: Record<CoopOutcome, { word: string; color: string; message: string }> = {
  pass: { word: 'PASS ★', color: PALETTE.e, message: 'PLAYER 2 APPROVES · PR LET THROUGH' },
  flagged: { word: 'FLAGGED', color: PALETTE.o, message: 'NO HIGH FINDING · PR LET THROUGH' },
  blocked: { word: 'FAIL', color: PALETTE.r, message: 'GH PR CREATE BLOCKED · FIX IT, OR /coop skip' },
  unreadable: { word: 'NO REVIEW', color: PALETTE.l, message: 'REVIEWER UNREADABLE · PR LET THROUGH' },
  skipped: { word: 'SKIPPED', color: PALETTE.v, message: '/coop skip · PR LET THROUGH UNREVIEWED' },
  empty: { word: 'NO DIFF', color: PALETTE.l, message: 'NOTHING TO REVIEW AGAINST THE BASE' },
}

const SEVERITY_COLOR = { high: PALETTE.r, medium: PALETTE.o, low: PALETTE.y } as const

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const firstLine = (text: string) => text.trim().split('\n')[0]?.slice(0, 200) ?? ''

type Settings = { model: string; command: string; maxDiffKb: number; timeoutMs: number }

type Request = { cwd?: string; baseFlag?: string; trigger: CoopRun['trigger']; isFresh: boolean; signal?: AbortSignal }

// ── status ───────────────────────────────────────────────────────────────

const showStatus = async ($: Engine) => {
  try {
    $.ui.status(
      statusText(await read($, lastAtom), {
        isReviewing: await read($, isReviewingAtom),
        skipNext: await read($, skipNextAtom),
      }),
    )
  } catch {
    // The status line is decoration.
  }
}

const toastFor = (run: CoopRun): string => {
  switch (run.outcome) {
    case 'pass':
      return `CO-OP ▸ 2P SAYS PASS${run.findings.length > 0 ? ` (${countsText(run.findings)})` : ''}`
    case 'flagged':
      return `CO-OP ▸ 2P FLAGGED ${countsText(run.findings)} · PR LET THROUGH`
    case 'blocked':
      return `CO-OP ▸ 2P SAYS FAIL ${countsText(run.findings)} · PR BLOCKED`
    case 'unreadable':
      return 'CO-OP ▸ REVIEW UNREADABLE · PR LET THROUGH'
    case 'skipped':
      return 'CO-OP ▸ SKIPPED · PR LET THROUGH'
    case 'empty':
      return 'CO-OP ▸ NO DIFF TO REVIEW'
  }
}

const openPane = async ($: Engine) => {
  try {
    await $.ui.open({ id: PANE, title: '2P REVIEW' })
  } catch {
    // No surface places panes (a -p run): the text reply stands.
  }
}

// ── git ──────────────────────────────────────────────────────────────────

const git = ($: Engine, argv: string[], cwd: string | undefined) =>
  $.process.run(['git', ...argv], { ...(cwd === undefined ? {} : { cwd }), timeoutMs: 60_000 })

const isCommit = async ($: Engine, ref: string, cwd: string | undefined) => {
  try {
    return (await git($, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd)).exitCode === 0
  } catch {
    return false
  }
}

/** The ref to diff against: --base (remote first), else origin/HEAD, else the usual names. */
const resolveBase = async ($: Engine, cwd: string | undefined, baseFlag: string | undefined) => {
  if (baseFlag !== undefined) {
    for (const ref of [`origin/${baseFlag}`, baseFlag]) if (await isCommit($, ref, cwd)) return ref
    return undefined
  }
  try {
    const head = await git($, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], cwd)
    if (head.exitCode === 0 && head.stdout.trim() !== '') return head.stdout.trim()
  } catch {
    // Fall through to the usual names.
  }
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) if (await isCommit($, ref, cwd)) return ref
  return undefined
}

const expandHome = async ($: Engine, path: string | undefined) => {
  if (path === undefined || !path.startsWith('~')) return path
  const home = await $.env.get('HOME').catch(() => undefined)
  return home ? `${home}${path.slice(1)}` : path
}

// ── the reviewer ─────────────────────────────────────────────────────────

type Asked = { review: Review; reviewer: string } | { reason: string; reviewer: string }

const askReviewer = async (
  $: Engine,
  settings: Settings,
  prompt: string,
  cwd: string | undefined,
  signal: AbortSignal | undefined,
): Promise<Asked> => {
  const argv = splitArgv(settings.command)
  if (argv.length > 0) {
    const reviewer = `command:${argv[0]}`
    try {
      const out = await $.process.run(argv, {
        ...(cwd === undefined ? {} : { cwd }),
        stdin: prompt,
        timeoutMs: settings.timeoutMs,
      })
      if (out.exitCode !== 0) {
        return { reviewer, reason: `reviewer command exited ${out.exitCode}: ${firstLine(out.stderr) || 'no stderr'}` }
      }
      const parsed = parseReview(out.stdout)
      return 'review' in parsed ? { reviewer, review: parsed.review } : { reviewer, reason: parsed.reason }
    } catch (error) {
      return { reviewer, reason: `reviewer command failed: ${errorText(error)}` }
    }
  }
  const sessionModel = await $.session.model().catch(() => '')
  const model = pickReviewerModel(settings.model, sessionModel)
  const reviewer = `model:${model}`
  try {
    const reply = await $.model.complete(
      { model, prompt, maxTokens: 4096, timeoutMs: settings.timeoutMs },
      signal === undefined ? undefined : { signal },
    )
    if (!reply.isAnswered) return { reviewer, reason: `the model call failed (${reply.reason})` }
    const parsed = parseReview(reply.text)
    return 'review' in parsed ? { reviewer, review: parsed.review } : { reviewer, reason: parsed.reason }
  } catch (error) {
    return { reviewer, reason: `the model call was refused (${errorText(error)})` }
  }
}

const outcomeOf = (review: Review): CoopOutcome =>
  isBlocking(review) ? 'blocked' : review.verdict === 'fail' ? 'flagged' : 'pass'

/** Diff, review, verdict. Never throws: anything that goes wrong is `unreadable`. */
const reviewBranch = async ($: Engine, settings: Settings, request: Request): Promise<CoopRun> => {
  const base: CoopRun = {
    outcome: 'unreadable',
    findings: [],
    base: '',
    reviewer: '',
    isTruncated: false,
    bytes: 0,
    maxDiffKb: settings.maxDiffKb,
    at: 0,
    trigger: request.trigger,
  }
  const finish = async (run: CoopRun) => ({ ...run, at: await $.clock.now().catch(() => 0) })
  try {
    const ref = await resolveBase($, request.cwd, request.baseFlag)
    if (ref === undefined) {
      const named = request.baseFlag === undefined ? 'no base branch found' : `base ${request.baseFlag} not found`
      return finish({ ...base, reason: `${named}; pass --base <branch> and fetch it` })
    }
    const diff = await git($, ['diff', '--no-color', '--no-ext-diff', `${ref}...HEAD`], request.cwd)
    if (diff.exitCode !== 0) {
      return finish({ ...base, base: ref, reason: `git diff failed: ${firstLine(diff.stderr) || `exit ${diff.exitCode}`}` })
    }
    if (diff.stdout.trim() === '') return finish({ ...base, base: ref, outcome: 'empty' })
    const cut = truncateDiff(diff.stdout, settings.maxDiffKb)
    // The whole diff, not just the part that fits: a change past the cut is still a change.
    const hash = hashText(`${ref}\n${settings.command}\n${settings.model}\n${settings.maxDiffKb}\n${diff.stdout}`)
    const last = await read($, lastAtom)
    if (!request.isFresh && last !== null && last.hash === hash && REUSABLE.includes(last.outcome)) {
      return finish({ ...last, trigger: request.trigger })
    }
    const prompt = buildReviewPrompt({
      diff: cut.text,
      base: ref,
      isTruncated: cut.isTruncated,
      bytes: cut.bytes,
      maxDiffKb: settings.maxDiffKb,
    })
    const sized = { ...base, base: ref, isTruncated: cut.isTruncated, bytes: cut.bytes }
    const asked = await askReviewer($, settings, prompt, request.cwd, request.signal)
    if ('reason' in asked) return finish({ ...sized, reviewer: asked.reviewer, reason: asked.reason })
    return finish({
      ...sized,
      reviewer: asked.reviewer,
      outcome: outcomeOf(asked.review),
      findings: asked.review.findings,
      hash,
    })
  } catch (error) {
    return finish({ ...base, reason: errorText(error) })
  }
}

/**
 * Runs one review with the REVIEWING state around it, then records and
 * announces it. `undefined` when the request's signal aborted meanwhile (the
 * person interrupted): nothing is recorded or announced for a call that is gone.
 */
const runReview = async ($: Engine, settings: Settings, request: Request): Promise<CoopRun | undefined> => {
  await $.state.set(IS_REVIEWING, true).catch(() => undefined)
  await $.state.set(IS_BAND_HIDDEN, false).catch(() => undefined)
  await showStatus($)
  let run: CoopRun
  try {
    run = await reviewBranch($, settings, request)
  } finally {
    await $.state.set(IS_REVIEWING, false).catch(() => undefined)
  }
  if (request.signal?.aborted === true) {
    await showStatus($)
    return undefined
  }
  await record($, run)
  return run
}

const record = async ($: Engine, run: CoopRun) => {
  try {
    await $.state.set(LAST, run)
    await $.state.set(IS_BAND_HIDDEN, false)
  } catch {
    // The verdict still stands for this call.
  }
  $.ui.toast(toastFor(run))
  await showStatus($)
}

const replyText = (run: CoopRun): string => {
  const head = `2P REVIEW ${VERDICT[run.outcome].word}`
  if (run.outcome === 'blocked') return `${head}\n${denyText(run).replace('gh pr create is BLOCKED', 'the next gh pr create would be BLOCKED')}`
  return `${head}\n${contextText(run)}`
}

const setSkip = async ($: Engine, isOn: boolean) => {
  await $.state.set(SKIP_NEXT, isOn)
  await showStatus($)
}

// ── register ─────────────────────────────────────────────────────────────

const numberOption = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

export const register: Register = (on, options) => {
  const settings: Settings = {
    model: typeof options.model === 'string' ? options.model : '',
    command: typeof options.command === 'string' ? options.command : '',
    maxDiffKb: Math.floor(numberOption(options.maxDiffKb, 200, 1, 10_240)),
    timeoutMs: Math.floor(numberOption(options.timeoutSeconds, 180, 10, 600) * 1000),
  }

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'coop',
        description: 'Second-model review of this branch: run it now, or skip the next PR gate',
        argumentHint: '[skip | unskip | view]',
      })
    } catch (error) {
      $.ui.toast(`CO-OP: could not register /coop (${errorText(error)})`)
    }
    await showStatus($)
    return next(e)
  })

  on('command.run', { command: 'coop' }, async ($, e, next) => {
    const verb = e.args.trim().toLowerCase()
    switch (verb) {
      case '': {
        const run = await runReview($, settings, { trigger: 'command', isFresh: true, signal: next.signal })
        if (run === undefined) return { text: 'CO-OP: review cancelled.' }
        await openPane($)
        return { text: replyText(run) }
      }
      case 'skip':
        await setSkip($, true)
        return { text: 'CO-OP: the next gh pr create goes through unreviewed. /coop unskip takes it back.' }
      case 'unskip':
        await setSkip($, false)
        return { text: 'CO-OP: the next gh pr create will be reviewed.' }
      case 'view': {
        await openPane($)
        const last = await read($, lastAtom)
        return { text: last === null ? 'CO-OP: no review yet this session.' : replyText(last) }
      }
      default:
        return { text: USAGE }
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isPrCreate(e.command)) return next(e)
    let run: CoopRun | undefined
    try {
      if (await read($, skipNextAtom)) {
        await $.state.set(SKIP_NEXT, false)
        run = {
          outcome: 'skipped',
          findings: [],
          base: '',
          reviewer: '',
          isTruncated: false,
          bytes: 0,
          maxDiffKb: settings.maxDiffKb,
          reason: '/coop skip',
          at: await $.clock.now(),
          trigger: 'pr-create',
        }
        await record($, run)
      } else {
        const cwd = await expandHome($, leadingCdOf(e.command))
        const baseFlag = baseFlagOf(e.command)
        run = await runReview($, settings, {
          ...(cwd === undefined ? {} : { cwd }),
          ...(baseFlag === undefined ? {} : { baseFlag }),
          trigger: 'pr-create',
          isFresh: false,
          signal: next.signal,
        })
      }
    } catch (error) {
      // co-op never blocks on its own failure.
      $.ui.toast(`CO-OP: review failed (${errorText(error)}) · PR LET THROUGH`)
      return next(e)
    }
    // Interrupted while the review ran: the call is gone, so never start gh after it.
    if (run === undefined) return { deny: CANCELLED }
    if (run.outcome === 'blocked') return { deny: denyText(run) }
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    return { ...ran, context: [...(ran.context ?? []), contextText(run)] } as typeof ran
  })

  // ── drawing ──────────────────────────────────────────────────────────────

  const countsLine = (findings: readonly CoopFinding[]) => {
    const counts = severityCounts(findings)
    return `● ${counts.high} HIGH  ● ${counts.medium} MED  ● ${counts.low} LOW`
  }

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const last = await read($, lastAtom)
    const isReviewing = await read($, isReviewingAtom)
    const isHidden = await read($, isBandHiddenAtom)
    if (e.props.hasSurvey || (!isReviewing && (last === null || isHidden))) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const verdict = isReviewing
      ? { word: 'REVIEWING...', color: PALETTE.y, message: 'PLAYER 2 IS READING THE DIFF' }
      : VERDICT[last?.outcome ?? 'unreadable']
    const counts = isReviewing || last === null
      ? 'HOLD ON: GH PR CREATE WAITS FOR THE REVIEW'
      : `${countsLine(last.findings)}${last.base === '' ? '' : `  VS ${last.base}`}${last.isTruncated ? `  · DIFF CUT AT ${last.maxDiffKb} KB` : ''}`
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Box flexDirection="column">
            {pixelRows(TWO_PLAYERS).map((row, y) => (
              <Box key={`players-${y}`} flexDirection="row">
                {row.map(cell => (
                  <Text color={cell.color} backgroundColor={cell.backgroundColor}>
                    {cell.text}
                  </Text>
                ))}
              </Box>
            ))}
          </Box>
          <Box flexDirection="column" flexShrink={1}>
            <Box flexDirection="row" gap={1}>
              <Box key="coop-title">
                <Text bold color={PALETTE.w} backgroundColor={PALETTE.u}>
                {' ▶ 2P REVIEW '}
              </Text>
              </Box>
              <Box key="coop-verdict">
                <Text bold color={verdict.color}>
                {verdict.word}
              </Text>
              </Box>
            </Box>
            <Box key="coop-counts">
              <Text color={PALETTE.l} wrap="truncate-end">
              {counts}
            </Text>
            </Box>
            <Box key="coop-message">
              <Text color={verdict.color} wrap="truncate-end">
              {!isReviewing && last?.outcome === 'unreadable' && last.reason ? `${verdict.message}: ${last.reason}` : verdict.message}
            </Text>
            </Box>
          </Box>
        </Box>
        {!isReviewing && (
          <Box flexDirection="row" gap={1}>
            <Button key="coop-view" label="VIEW" hotkey="v" variant="primary" onPress={() => openPane($)} />
            <Button key="coop-ok" label="OK" hotkey="o" role="dismiss" onPress={() => $.state.set(IS_BAND_HIDDEN, true)} />
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const last = await read($, lastAtom)
    const isReviewing = await read($, isReviewingAtom)
    const skipNext = await read($, skipNextAtom)
    const width = Math.max(24, e.props.bodyColumns)
    const verdict = isReviewing
      ? { word: 'REVIEWING...', color: PALETTE.y }
      : last === null
        ? { word: 'NO REVIEW YET', color: PALETTE.l }
        : VERDICT[last.outcome]
    const meta =
      last === null
        ? 'RUN /coop, OR OPEN A PR: GH PR CREATE IS REVIEWED FIRST'
        : [
            last.reviewer === '' ? 'NO REVIEWER' : last.reviewer,
            last.base === '' ? '' : `VS ${last.base}`,
            last.bytes > 0 ? `${Math.ceil(last.bytes / 1024)} KB` : '',
            last.isTruncated ? `CUT AT ${last.maxDiffKb} KB` : '',
          ]
            .filter(part => part !== '')
            .join(' · ')
    const findings = last?.findings ?? []
    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row" gap={2}>
          <Box flexDirection="column">
            {pixelRows(TWO_PLAYERS).map((row, y) => (
              <Box key={`players-${y}`} flexDirection="row">
                {row.map(cell => (
                  <Text color={cell.color} backgroundColor={cell.backgroundColor}>
                    {cell.text}
                  </Text>
                ))}
              </Box>
            ))}
          </Box>
          <Box flexDirection="column" flexShrink={1}>
            <Box flexDirection="row" gap={1}>
              <Text bold color={PALETTE.w} backgroundColor={PALETTE.u}>
                {' 2P REVIEW '}
              </Text>
              <Box key="coop-pane-verdict">
                <Text bold color={verdict.color}>
                {verdict.word}
              </Text>
              </Box>
            </Box>
            <Box key="coop-pane-meta">
              <Text color={PALETTE.l} wrap="truncate-end">
              {meta}
            </Text>
            </Box>
            <Text color={PALETTE.l}>{last === null ? '' : countsLine(findings)}</Text>
          </Box>
        </Box>
        <Text color={PALETTE.d}>{'─'.repeat(Math.min(width, 60))}</Text>
        {last !== null && findings.length === 0 && (
          <Text color={PALETTE.l} wrap="wrap">
            {last.outcome === 'unreadable' ? `NO FINDINGS: ${last.reason ?? 'the review could not be read'}` : 'NO FINDINGS'}
          </Text>
        )}
        {findings.map((finding, index) => (
          <Box key={`finding-${index}`} flexDirection="row" gap={1}>
            <Box key={`finding-${index}-tag`}>
              <Text bold color={SEVERITY_COLOR[finding.severity]}>
              {findingLine({ ...finding, file: '', summary: '' }).trimEnd().padEnd(4)}
            </Text>
            </Box>
            <Box flexDirection="column" flexShrink={1}>
              {finding.file !== '' && (
                <Box key={`finding-${index}-place`}>
                  <Text color={PALETTE.u}>
                  {`${finding.file}${finding.line === undefined ? '' : `:${finding.line}`}`}
                </Text>
                </Box>
              )}
              <Box key={`finding-${index}-summary`}>
                <Text color={PALETTE.w} wrap="wrap">
                {finding.summary}
              </Text>
              </Box>
            </Box>
          </Box>
        ))}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Button
            key="coop-skip"
            label={skipNext ? 'UNSKIP' : 'SKIP NEXT'}
            onPress={async () => {
              await update($, skipNextAtom, isOn => !isOn)
              await showStatus($)
            }}
          />
          <Text color={skipNext ? PALETTE.v : PALETTE.d}>
            {skipNext ? 'NEXT GH PR CREATE GOES THROUGH UNREVIEWED' : 'GH PR CREATE IS REVIEWED FIRST'}
          </Text>
        </Box>
      </Box>
    )
  })
}
