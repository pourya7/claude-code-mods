import { atom, read, update } from 'claude-code'
import type { Register, Timer } from 'claude-code'

import type { RespawnRun } from '../types'
import {
  IDLE_RUN,
  PLUGIN,
  cancelRun,
  continuePrompt,
  describeRun,
  hearts,
  isOwnPrompt,
  isUserPrompt,
  livesLeft,
  livesOption,
  minutesToNextLife,
  refreshGameOver,
  spendLife,
  startCountdown,
  statusLine,
  tickRun,
} from './logic'
import { BROKEN_HEART, HEART, PALETTE, besides, digitsGrid, pixelRows } from './pixels'
import type { Run } from './pixels'

const run = atom({ plugin: 'respawn', key: 'run' } as const, IDLE_RUN)

type Dollar = Parameters<Parameters<Parameters<Register>[0]>[1]>[0]
type Settings = { lives: number; promptText: string }

// Timers cannot live in $.state, and a reload cancels them along with this
// variable; session.start (raised on a reload too) arms them again from `run`.
let ticker: Timer | undefined

const GAME_OVER_TICK_MS = 60_000

function stopTicker(): void {
  ticker?.cancel()
  ticker = undefined
}

async function showStatus($: Dollar, settings: Settings, current: RespawnRun): Promise<void> {
  $.ui.status(statusLine(current, settings.lives, await $.clock.now()))
}

/** Cancels a countdown and resets the backoff; a user prompt also ends GAME OVER. */
async function cancel($: Dollar, settings: Settings, isUser: boolean): Promise<void> {
  const current = await read($, run)
  const isQuiet = current.phase === 'idle' && current.attempt === 0
  if (isQuiet || (current.phase === 'gameover' && !isUser)) return
  stopTicker()
  const next = await update($, run, value => (value.phase === 'gameover' && !isUser ? value : cancelRun(value)))
  await showStatus($, settings, next)
}

/** The countdown ran out or INSERT COIN was pressed: spend a life and continue. */
async function insertCoin($: Dollar, settings: Settings): Promise<void> {
  const now = await $.clock.now()
  // Check and spend in one update, so two presses close together spend one life.
  let isMine = false as boolean
  const next = await update($, run, value => {
    // update() runs this again on a version miss: the last call decides.
    isMine = value.phase === 'countdown' && !value.isOff
    return isMine ? spendLife(value, now) : value
  })
  if (!isMine) return
  stopTicker()
  await showStatus($, settings, next)
  try {
    await $.prompt.submit({ text: settings.promptText, asUser: true })
  } catch {
    $.ui.toast('RESPAWN: could not submit the continue prompt')
  }
}

async function tick($: Dollar, settings: Settings): Promise<void> {
  const current = await read($, run)
  if (current.phase !== 'countdown') return stopTicker()
  const now = await $.clock.now()
  if (now >= current.dueAt) return insertCoin($, settings)
  await showStatus($, settings, await update($, run, value => tickRun(value, now)))
}

/** GAME OVER: once a minute, move the "next life" minutes and the hearts. */
async function tickGameOver($: Dollar, settings: Settings): Promise<void> {
  const current = await read($, run)
  if (current.phase !== 'gameover') return stopTicker()
  const now = await $.clock.now()
  const next = await update($, run, value => (value.phase === 'gameover' ? refreshGameOver(value, now) : value))
  await showStatus($, settings, next)
  if (next.spentAt.length === 0) stopTicker()
}

/** Starts the ticker that fits the phase in `run`, or none. */
function arm($: Dollar, settings: Settings, current: RespawnRun): void {
  stopTicker()
  if (current.isOff) return
  if (current.phase === 'countdown') {
    ticker = $.clock.every(1000, () => void tick($, settings).catch(stopTicker))
  } else if (current.phase === 'gameover' && current.spentAt.length > 0) {
    ticker = $.clock.every(GAME_OVER_TICK_MS, () => void tickGameOver($, settings).catch(stopTicker))
  }
}

async function startRespawn($: Dollar, settings: Settings): Promise<void> {
  const now = await $.clock.now()
  const before = await read($, run)
  const next = await update($, run, value => (value.isOff ? value : startCountdown(value, now, settings.lives)))
  await showStatus($, settings, next)
  // A turn dying again in GAME OVER keeps the minute ticker already running.
  if (before.phase === 'gameover' && next.phase === 'gameover' && ticker !== undefined) return
  arm($, settings, next)
}

async function switchOff($: Dollar): Promise<void> {
  stopTicker()
  await update($, run, value => ({ ...cancelRun(value), isOff: true }))
  $.ui.status(undefined)
}

export const register: Register = (on, options) => {
  const settings: Settings = { lives: livesOption(options.lives), promptText: continuePrompt(options.prompt) }
  const { lives, promptText } = settings

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: PLUGIN,
        description: 'Show the auto-continue state; /respawn off or /respawn on',
        argumentHint: '[off|on]',
        immediate: true,
      })
    } catch {
      $.ui.toast('RESPAWN: /respawn could not be registered')
    }

    // A reload (a code change or a userConfig change) cancelled our timers:
    // pick the countdown or the GAME OVER minutes up where `run` left them.
    const current = await read($, run)
    if (current.phase === 'countdown' && !current.isOff) {
      const now = await $.clock.now()
      await showStatus($, settings, await update($, run, value => tickRun(value, now)))
    }
    arm($, settings, current)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    if (e.reason === 'error') await startRespawn($, settings)
    if (e.reason === 'answer') await cancel($, settings, false)

    return result
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isOwnPrompt(e.origin)) await cancel($, settings, isUserPrompt(e.origin))

    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const isChange = e.inputText !== '' || e.start !== e.end
    if (isChange) await cancel($, settings, true)

    return next(e)
  })

  on('command.run', { command: 'respawn' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'off') await switchOff($)
    if (word === 'on') await update($, run, value => ({ ...value, isOff: false }))
    const now = await $.clock.now()
    const text = describeRun(await read($, run), lives, now)
    const isKnown = word === '' || word === 'off' || word === 'on'

    return { text: isKnown ? text : `${text}\nUsage: /respawn [off|on]` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) return next(e)
    const current = await read($, run)
    if (current.isOff || current.phase === 'idle') return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const left = livesLeft(current.spentAt, lives, now)
    const isOver = current.phase === 'gameover'

    const sprite = isOver ? [...BROKEN_HEART] : besides([HEART, digitsGrid(current.secondsLeft)], 2)
    const pixels = pixelRows(sprite).map(runs => (
      <Box key="digit-row" flexDirection="row">
        {runs.map((cell: Run) => (
          <Text color={cell.color} backgroundColor={cell.backgroundColor}>
            {cell.text}
          </Text>
        ))}
      </Box>
    ))

    const minutesToLife = minutesToNextLife(current.spentAt, now)

    const lines = isOver
      ? [
          <Text color={PALETTE.w}>{left === 0 ? 'OUT OF LIVES THIS HOUR' : 'LIVES ARE BACK'}</Text>,
          <Box key="next-life">
            <Text color={PALETTE.l}>
              {left === 0 ? `NEXT LIFE IN ${minutesToLife} MIN` : `${left} READY, HELD FOR YOU`}
            </Text>
          </Box>,
          <Text color={PALETTE.l}>TYPE ANYTHING TO PLAY ON</Text>,
        ]
      : [
          <Text color={PALETTE.w}>TURN DIED ON AN API ERROR</Text>,
          <Box flexDirection="row">
            <Text color={PALETTE.l}>SENDING "{promptText.toUpperCase()}" IN </Text>
            <Box key="seconds">
              <Text color={PALETTE.y} bold>
                {String(current.secondsLeft)}
              </Text>
            </Box>
            <Text color={PALETTE.l}>S</Text>
          </Box>,
          <Text color={PALETTE.l}>TRY {String(current.attempt + 1)} · TYPE ANYTHING TO CANCEL</Text>,
        ]

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Box key="title">
            <Text color={isOver ? PALETTE.r : PALETTE.o} bold>
              {isOver ? '▶ GAME OVER' : '▶ CONTINUE?'}
            </Text>
          </Box>
          <Text> </Text>
          <Box key="lives">
            <Text color={PALETTE.r}>{hearts(left, lives)}</Text>
          </Box>
          <Text color={PALETTE.d}> 1UP RESPAWN</Text>
        </Box>
        <Box flexDirection="row">
          <Box flexDirection="column">{pixels}</Box>
          <Box flexDirection="column" marginLeft={2}>
            {lines}
          </Box>
        </Box>
        {isOver ? (
          <Box flexDirection="row">
            <Button key="dismiss" label="OK" hotkey="o" role="dismiss" onPress={() => cancel($, settings, true)} />
          </Box>
        ) : (
          <Box flexDirection="row">
            <Button
              key="insert-coin"
              label="INSERT COIN"
              hotkey="c"
              variant="primary"
              onPress={() => insertCoin($, settings)}
            />
            <Text> </Text>
            <Button key="game-over" label="GAME OVER" hotkey="x" onPress={() => cancel($, settings, true)} />
          </Box>
        )}
      </Box>
    )
  })
}
