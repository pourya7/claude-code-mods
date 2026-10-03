import { atom, read, update } from 'claude-code'
import type { Register, SessionMessage } from 'claude-code'

import type { QuicksaveBand } from '../types'
import { FLOPPY, PALETTE, pixelRows } from './pixels'
import type { Run } from './pixels'
import {
  PLUGIN,
  SAVE_PROMPT,
  compactInstructions,
  failureText,
  parseSave,
  percentOption,
  pickSlot,
  pushSlot,
  readSlots,
  touchSession,
  saveMarkdown,
  saveNote,
  shouldShowBand,
  slotList,
  stamp,
  withNote,
  writeFileOption,
} from './save'
import type { Slot } from './save'

const band = atom({ plugin: 'quicksave', key: 'band' } as const, {} as QuicksaveBand)

type Dollar = Parameters<Parameters<Parameters<Register>[0]>[1]>[0]
type Settings = { threshold: number; writeFile: boolean }
type Taken = { slot: Slot } | { failure: string }

const slotsKey = (sessionId: string): string => `slots/${sessionId}`
const SESSIONS_KEY = 'sessions'

// The note `[ SAVE + COMPACT ]` hands to its own compaction while that call
// is in flight. Nothing here needs to survive a reload: a reload cancels the
// call with it.
let ownCompaction: { note: string; isInjected: boolean } | undefined

// The save being taken now. A second request while it runs (a double press,
// /quicksave, a compaction) waits for this one instead of starting another
// fork, so two read-modify-writes of the slot list never race.
let inFlight: Promise<Taken> | undefined

// True while `[ SAVE + COMPACT ]` runs, so a second press starts no second compaction.
let isCompacting = false

async function readStoredSlots($: Dollar): Promise<Slot[]> {
  try {
    return readSlots(await $.store.get(slotsKey(await $.session.id())))
  } catch {
    return []
  }
}

/** One save at a time: joins the save in flight, or starts one and shows SAVING on the band while it runs. */
function takeSave($: Dollar, settings: Settings, trigger: string): Promise<Taken> {
  if (inFlight !== undefined) return inFlight
  const run = (async (): Promise<Taken> => {
    await update($, band, value => ({ ...value, isSaving: true })).catch(() => undefined)
    try {
      return await forkAndStore($, settings, trigger)
    } finally {
      inFlight = undefined
      await update($, band, ({ isSaving: _, ...rest }) => rest).catch(() => undefined)
    }
  })()
  inFlight = run
  return run
}

/** Forks the conversation for a save, keeps it in the newest slot, mirrors it when asked. */
async function forkAndStore($: Dollar, settings: Settings, trigger: string): Promise<Taken> {
  let reply: Awaited<ReturnType<Dollar['model']['fork']>>
  try {
    reply = await $.model.fork({ prompt: SAVE_PROMPT })
  } catch {
    return { failure: 'fork-error' }
  }
  if (!reply.isAnswered) return { failure: reply.reason }

  const slot: Slot = { at: await $.clock.now(), trigger, save: parseSave(reply.text) }
  let sessionId = 'session'
  try {
    sessionId = await $.session.id()
    const slots = readSlots(await $.store.get(slotsKey(sessionId)))
    await $.store.set(slotsKey(sessionId), pushSlot(slots, slot))
    const { keep, drop } = touchSession(await $.store.get(SESSIONS_KEY), sessionId)
    await $.store.set(SESSIONS_KEY, keep)
    for (const old of drop) await $.store.delete(slotsKey(old))
  } catch {
    $.ui.toast('QUICKSAVE ✕ the save could not be stored')
    return { failure: 'store-error' }
  }

  if (settings.writeFile) {
    try {
      const cwd = await $.session.cwd()
      await $.fs.write(`${cwd}/.claude/quicksave/${sessionId}.md`, saveMarkdown(slot, sessionId))
    } catch {
      $.ui.toast('QUICKSAVE ✕ could not write the save file')
    }
  }

  $.ui.toast(`QUICKSAVE ★ SLOT 1 SAVED ${stamp(slot.at).slice(11)}`)
  return { slot }
}

async function saveFromBand($: Dollar, settings: Settings): Promise<Slot | undefined> {
  const taken = await takeSave($, settings, 'band')
  if ('failure' in taken) {
    $.ui.toast(`QUICKSAVE ✕ SAVE FAILED (${taken.failure})`)
    return undefined
  }
  await update($, band, value => ({ ...value, savedSlot: 1 }))
  return taken.slot
}

/** `[ SAVE + COMPACT ]`: save, then compact with the save in the instructions and handed back after. */
async function saveAndCompact($: Dollar, settings: Settings): Promise<void> {
  if (isCompacting) return
  isCompacting = true
  try {
    await saveThenCompact($, settings)
  } finally {
    isCompacting = false
  }
}

async function saveThenCompact($: Dollar, settings: Settings): Promise<void> {
  const slot = await saveFromBand($, settings)
  const note = slot === undefined ? undefined : saveNote(slot, 1)
  ownCompaction = note === undefined ? undefined : { note, isInjected: false }
  try {
    const result = await $.session.compact(note === undefined ? {} : { instructions: compactInstructions(note) })
    if (result.skip !== undefined) {
      $.ui.toast(`QUICKSAVE ▸ compaction skipped: ${result.skip}`)
      return
    }
    await update($, band, () => ({}))
    // Our own session.compact hook is skipped for our own call, so the save
    // goes back in as a user-role row once the compacted transcript stands.
    if (note !== undefined && !ownCompaction?.isInjected) {
      try {
        const appended = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: note }] } })
        if (appended.deny !== undefined) throw new Error(appended.deny)
      } catch {
        $.ui.toast('QUICKSAVE ▸ compacted. /quickload 1 hands the save back')
      }
    }
  } catch {
    $.ui.toast('QUICKSAVE ✕ could not compact now')
  } finally {
    ownCompaction = undefined
  }
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    threshold: percentOption(options.warnAtPercent),
    writeFile: writeFileOption(options.writeFile),
  }

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'quicksave',
        description: 'Save the task state now; /quicksave list shows the slots',
        argumentHint: '[list]',
      })
      await $.command.register({
        name: 'quickload',
        description: 'Hand a save back to the model (1 = newest)',
        argumentHint: '[slot]',
      })
    } catch {
      $.ui.toast('QUICKSAVE ✕ /quicksave could not be registered')
    }
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    // A precompute installs nothing (the compaction it serves raises this
    // hook again), and a subagent's compaction is not the session's plot.
    if (e.trigger === 'precompute' || e.agentId !== undefined) return next(e)

    if (ownCompaction !== undefined) {
      const own = ownCompaction
      const result = await next(e)
      if (result.skip !== undefined) return result
      own.isInjected = true
      return { ...result, messages: withNote(result.messages, own.note) as SessionMessage[] }
    }

    const taken = await takeSave($, settings, e.trigger)
    if ('failure' in taken) $.ui.toast(failureText(taken.failure))
    const result = await next(e)
    if (result.skip !== undefined) return result
    await update($, band, () => ({}))
    if ('failure' in taken) return result

    return { ...result, messages: withNote(result.messages, saveNote(taken.slot, 1)) as SessionMessage[] }
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.changed.includes('context')) {
      const percent = e.context.percent
      await update($, band, value => ({
        ...(value.isSaving === true ? { isSaving: true } : {}),
        ...(percent === undefined ? {} : { percent }),
      }))
    }
    return result
  })

  on('command.run', { command: 'quicksave' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'list') return { text: slotList(await readStoredSlots($)) }
    if (word !== '') return { text: 'Usage: /quicksave (save now) or /quicksave list' }

    const taken = await takeSave($, settings, 'command')
    if ('failure' in taken) return { text: `QUICKSAVE ✕ SAVE FAILED (${taken.failure}). Nothing was stored.` }
    const goal = taken.slot.save.goal || '(no goal recorded)'
    return { text: `QUICKSAVE ★ SAVED TO SLOT 1 · ${goal}\n/quickload hands it back to the model.` }
  })

  on('command.run', { command: 'quickload' }, async ($, e) => {
    const word = e.args.trim()
    const slot = pickSlot(await readStoredSlots($), word)
    const number = word === '' ? 1 : Number(word)
    if (slot === undefined || !Number.isInteger(number)) {
      return { text: `QUICKSAVE ▸ NO SAVE IN SLOT ${word || '1'}. /quicksave list shows what there is.` }
    }
    return {
      text: `QUICKSAVE ▸ LOADED SLOT ${number} (${stamp(slot.at)} UTC). The model reads it with your next message.`,
      context: [saveNote(slot, number)],
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) return next(e)
    const current = await read($, band)
    const { percent } = current
    const isCandidate = shouldShowBand({ percent, threshold: settings.threshold, isWorking: e.props.isWorking, runningAgents: 0 })
    if (!isCandidate) return next(e)

    let runningAgents = 0
    try {
      runningAgents = (await $.agent.list()).filter(agent => agent.status === 'running').length
    } catch {
      runningAgents = 0
    }
    if (runningAgents > 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const fill = Math.max(0, Math.min(10, Math.round((percent ?? 0) / 10)))
    const pixels = pixelRows(FLOPPY).map(runs => (
      <Box key="floppy-row" flexDirection="row">
        {runs.map((cell: Run) => (
          <Text color={cell.color} backgroundColor={cell.backgroundColor}>
            {cell.text}
          </Text>
        ))}
      </Box>
    ))

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Box key="title">
            <Text color={PALETTE.e} bold>
              SAVE POINT ▸ safe to /compact
            </Text>
          </Box>
          <Text color={PALETTE.d}> QUICKSAVE</Text>
        </Box>
        <Box flexDirection="row">
          <Box flexDirection="column">{pixels}</Box>
          <Box flexDirection="column" marginLeft={2}>
            <Box flexDirection="row">
              <Text color={PALETTE.l}>CONTEXT </Text>
              <Text color={PALETTE.g}>{'█'.repeat(fill)}</Text>
              <Text color={PALETTE.d}>{'░'.repeat(10 - fill)}</Text>
              <Text color={PALETTE.w}> {String(percent)}%</Text>
            </Box>
            <Text color={PALETTE.l}>IDLE · NOTHING RUNNING</Text>
            {current.isSaving === true ? (
              <Box key="saving">
                <Text color={PALETTE.y}>SAVING… HOLD STILL</Text>
              </Box>
            ) : current.savedSlot === undefined ? (
              <Text color={PALETTE.l}>SAVES GOAL, BRANCH, RULES, NEXT STEP</Text>
            ) : (
              <Box key="saved">
                <Text color={PALETTE.e}>SAVED ★ SLOT {String(current.savedSlot)}</Text>
              </Box>
            )}
            <Text color={PALETTE.d}>/quickload HANDS IT BACK</Text>
          </Box>
        </Box>
        <Box flexDirection="row">
          <Button key="save" label="SAVE" hotkey="s" variant="primary" onPress={async () => { await saveFromBand($, settings) }} />
          <Text> </Text>
          <Button key="save-compact" label="SAVE + COMPACT" hotkey="c" onPress={() => saveAndCompact($, settings)} />
        </Box>
      </Box>
    )
  })
}
