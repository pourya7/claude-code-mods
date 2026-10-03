// prove-it: the fix must make a test fail first. /prove reverts the changed
// sources to the merge base, requires the changed tests to fail, restores the
// sources (verified by hash) and requires them to pass. With the gate on, the
// same proof runs before git push and gh pr create.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ProvePhase, ProveProof } from '../types'
import { DEFAULT_TEST_GLOBS, parseGlobList, splitCommand } from './files'
import { CRACKED, CROSS, FLASK, PALETTE, STAR, pixelRows } from './pixels'
import type { Run } from './pixels'
import { INTERRUPTED, emptyProof, runProof, survey } from './prove'
import type { Host, ProveSettings } from './prove'
import { denyText, gateAllows, gatedCommand, replyText, statusLine, verdictLabel } from './verdict'

type Dollar = EngineInterface

const MAX_TIMEOUT_SECONDS = 600
const DEFAULT_TIMEOUT_SECONDS = 300

const proofAtom = atom({ plugin: 'prove-it', key: 'proof' } as const, null as ProveProof | null)
const phaseAtom = atom({ plugin: 'prove-it', key: 'phase' } as const, 'idle' as ProvePhase)
/** Who holds the run: '' when nobody does, else the holder's own token. */
const ownerAtom = atom({ plugin: 'prove-it', key: 'owner' } as const, '')
const skipAtom = atom({ plugin: 'prove-it', key: 'skipNext' } as const, false)
const hiddenAtom = atom({ plugin: 'prove-it', key: 'isBandHidden' } as const, false)

type Options = Record<string, unknown>

const timeoutSecondsOf = (value: unknown): number => {
  const seconds = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_SECONDS
  return Math.min(MAX_TIMEOUT_SECONDS, seconds)
}

const settingsOf = (options: Options, tmpDir: string): ProveSettings => {
  const testGlobs = parseGlobList(options.testGlobs)
  return {
    testCommand: splitCommand(typeof options.testCommand === 'string' ? options.testCommand : ''),
    testGlobs: testGlobs.length > 0 ? testGlobs : [...DEFAULT_TEST_GLOBS],
    sourceGlobs: parseGlobList(options.sourceGlobs),
    base: typeof options.base === 'string' ? options.base.trim() : '',
    timeoutMs: timeoutSecondsOf(options.timeoutSeconds) * 1000,
    tmpDir,
  }
}

const hostOf = ($: Dollar, isGateOn: boolean, signal: AbortSignal | undefined): Host => ({
  run: (argv, init) => $.process.run(argv, init),
  write: (path, text) => $.fs.write(path, text),
  exists: path => $.fs.exists(path),
  onPhase: async phase => {
    await update($, phaseAtom, () => phase)
    await update($, hiddenAtom, () => false)
    $.ui.status(statusLine(await read($, proofAtom), phase, isGateOn))
  },
  signal,
})

let runCount = 0

const PROBLEM_VERDICTS = new Set(['restore-failed', 'error'])

/**
 * Proves the change as it stands. A proof already made for the same
 * fingerprint is reused unless it was an error, so a push followed by a PR
 * create runs the tests once.
 */
const proveNow = async (
  $: Dollar,
  options: Options,
  isGateOn: boolean,
  reuse: boolean,
  signal?: AbortSignal,
): Promise<ProveProof> => {
  const at = await $.clock.now()
  // Claim the run in one update, so two proofs never revert the same files at
  // once; only this token releases it, so a claim is never let go early or by another run.
  runCount += 1
  const token = `${at}:${runCount}:${Math.random()}`
  let isMine = false as boolean
  await update($, ownerAtom, owner => {
    isMine = owner === ''
    return isMine ? token : owner
  })
  if (!isMine) return emptyProof('error', 'a proof is already running; wait for it to finish', at)

  try {
    await update($, phaseAtom, () => 'without' as ProvePhase)
    const tmpDir = (await $.env.get('TMPDIR')) ?? ''
    const settings = settingsOf(options, tmpDir === '' ? '/tmp' : tmpDir)
    const host = hostOf($, isGateOn, signal)
    const cwd = await $.session.cwd()

    const surveyed = await survey(host, cwd, settings, at)
    const last = await read($, proofAtom)
    const isSame =
      reuse &&
      !('verdict' in surveyed) &&
      last !== null &&
      last.fingerprint === surveyed.fingerprint &&
      !PROBLEM_VERDICTS.has(last.verdict)
    const proof =
      'verdict' in surveyed ? surveyed : isSame && last !== null ? last : await runProof(host, surveyed, settings, at)

    await update($, proofAtom, () => proof)
    await update($, hiddenAtom, () => false)
    if (proof.verdict === 'restore-failed') $.ui.toast(`PROVE-IT ▸ RESTORE FAILED · copies in ${proof.copiesDir}`)
    else if (proof.detail === INTERRUPTED) $.ui.toast('PROVE-IT ▸ INTERRUPTED · YOUR FILES ARE BACK')

    return proof
  } finally {
    let isReleased = false as boolean
    await update($, ownerAtom, owner => {
      isReleased = owner === token
      return isReleased ? '' : owner
    })
    if (isReleased) {
      await update($, phaseAtom, () => 'idle' as ProvePhase)
      $.ui.status(statusLine(await read($, proofAtom), 'idle', isGateOn))
    }
  }
}

const USAGE = 'Usage: /prove [run|status|skip]'

export const register: Register = (on, options) => {
  const isGateOn = options.gate === true

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'prove',
        description: 'Prove the fix: the changed tests must fail without it and pass with it',
        argumentHint: '[run|status|skip]',
      })
    } catch {
      $.ui.toast('PROVE-IT: /prove could not be registered')
    }
    // A run cannot outlive a reload of this module: clear a claim and phase one left behind.
    await update($, ownerAtom, () => '')
    await update($, phaseAtom, () => 'idle' as ProvePhase)
    $.ui.status(statusLine(await read($, proofAtom), 'idle', isGateOn))

    return next(e)
  })

  on('command.run', { command: 'prove' }, async ($, e, next) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'skip') {
      await update($, skipAtom, () => true)
      $.ui.toast('PROVE-IT ▸ SKIP ARMED')
      return { text: 'PROVE-IT ▸ the next push or PR goes through without a proof.' }
    }
    if (word === 'status') {
      const proof = await read($, proofAtom)
      const skip = (await read($, skipAtom)) ? '\nThe next push or PR is skipped.' : ''
      return { text: `${proof === null ? 'PROVE-IT ▸ no proof yet. Run /prove.' : replyText(proof)}${skip}` }
    }
    if (word !== '' && word !== 'run') return { text: USAGE }

    const proof = await proveNow($, options, isGateOn, false, next.signal)
    const text = replyText(proof)
    return { text, context: [text], exitCode: gateAllows(proof.verdict) ? 0 : 1 }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = isGateOn ? gatedCommand(e.command) : null
    if (command === null) return next(e)

    if (await read($, skipAtom)) {
      await update($, skipAtom, () => false)
      $.ui.toast(`PROVE-IT ▸ SKIPPED FOR ${command.toUpperCase()}`)
      return next(e)
    }

    const proof = await proveNow($, options, isGateOn, true, next.signal)
    if (gateAllows(proof.verdict)) return next(e)

    $.ui.toast(`PROVE-IT ▸ ${verdictLabel(proof.verdict)} · ${command.toUpperCase()} REFUSED`)
    return { deny: denyText(proof, command) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) return next(e)
    const phase = await read($, phaseAtom)
    const proof = await read($, proofAtom)
    const isRunning = phase !== 'idle'
    if (!isRunning && (proof === null || (await read($, hiddenAtom)))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const verdict = proof?.verdict ?? 'error'
    const isGood = !isRunning && gateAllows(verdict)
    const sprite = isRunning
      ? FLASK
      : verdict === 'proven'
        ? STAR
        : verdict === 'error' || verdict === 'restore-failed'
          ? CRACKED
          : isGood
            ? STAR
            : CROSS
    const pixels = pixelRows(sprite).map(runs => (
      <Box flexDirection="row">
        {runs.map((cell: Run) => (
          <Text color={cell.color} backgroundColor={cell.backgroundColor}>
            {cell.text}
          </Text>
        ))}
      </Box>
    ))

    const title = isRunning ? 'PROVING...' : verdictLabel(verdict)
    const titleColor = isRunning ? PALETTE.o : isGood ? PALETTE.i : PALETTE.r
    const runText = (exitCode: number | undefined) =>
      exitCode === undefined ? '-' : exitCode === 0 ? '★ PASS' : `× FAIL ${exitCode}`
    const lines = isRunning
      ? [
          <Text color={phase === 'without' ? PALETTE.y : PALETTE.l}>1 WITHOUT THE FIX {phase === 'without' ? '◆' : '★'}</Text>,
          <Text color={phase === 'with' ? PALETTE.y : PALETTE.d}>2 WITH THE FIX {phase === 'with' ? '◆' : '·'}</Text>,
          <Text color={PALETTE.d}>YOUR FILES COME BACK EITHER WAY</Text>,
        ]
      : [
          <Box key="without">
            <Text color={(proof?.without?.exitCode ?? 0) === 0 ? PALETTE.l : PALETTE.r}>
              WITHOUT THE FIX {runText(proof?.without?.exitCode)}
            </Text>
          </Box>,
          <Box key="with">
            <Text color={(proof?.with?.exitCode ?? 1) === 0 ? PALETTE.i : PALETTE.l}>
              WITH THE FIX {'   '}
              {runText(proof?.with?.exitCode)}
            </Text>
          </Box>,
          <Text color={PALETTE.l}>
            {proof === null
              ? ''
              : `${proof.sources.length} SOURCE · ${proof.tests.length} TEST${proof.base === '' ? '' : ` · BASE ${proof.base}`}`}
          </Text>,
        ]

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Box key="title">
            <Text color={titleColor} bold>
              ▶ {title}
            </Text>
          </Box>
          <Text color={PALETTE.d}> PROVE-IT</Text>
        </Box>
        <Box flexDirection="row">
          <Box flexDirection="column">{pixels}</Box>
          <Box flexDirection="column" marginLeft={2}>
            {lines}
            {isRunning ? null : (
              <Box flexDirection="row">
                <Button key="ok" label="OK" hotkey="o" role="dismiss" onPress={() => update($, hiddenAtom, () => true)} />
                <Text> </Text>
                <Button key="again" label="AGAIN" hotkey="a" onPress={() => proveNow($, options, isGateOn, false)} />
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    )
  })
}
