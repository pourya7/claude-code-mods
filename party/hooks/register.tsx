// party: the raid frame for your sessions. Every session heartbeats into the
// plugin store; the pane shows who is working and who waits on you; PR actions
// another session took recently turn into a permission prompt here.
import { atom, read } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { PartyMember, PartyState, PartyWait } from '../types'
import {
  HEARTBEAT_MS,
  KEY_PREFIX,
  PLUGIN,
  addTouch,
  broadcastTargets,
  describeRoster,
  displayName,
  formatAge,
  liveMembers,
  lockReason,
  memberKey,
  nagDue,
  nagKey,
  otherTouch,
  place,
  playerTags,
  prTarget,
  repoFromRemote,
  staleKeys,
  stateText,
  statusLine,
  titleFrom,
  waitBar,
  waitKind,
  withState,
} from './party'
import type { PrTarget } from './party'
import { BANNER, BAR_COLOR, CLASS_ICON, PICO, SIGNATURE, STATE_COLOR, barText, halfBlockRows } from './pixels'
import type { PixelRun } from './pixels'

const PANE = 'party'
const BAR_CELLS = 10
const GIT_TIMEOUT_MS = 5_000

const EMPTY_SELF: PartyMember = {
  sessionId: '',
  title: '',
  cwd: '',
  branch: '',
  repo: null,
  state: 'idle',
  since: 0,
  waitingFor: null,
  lastTool: '',
  beatAt: 0,
  touches: [],
}

const SELF = { plugin: 'party', key: 'self' } as const
const ROSTER = { plugin: 'party', key: 'roster' } as const
const NAGGED = { plugin: 'party', key: 'nagged' } as const
const selfAtom = atom(SELF, EMPTY_SELF)
const rosterAtom = atom(ROSTER, [] as PartyMember[])
const naggedAtom = atom(NAGGED, [] as string[])

// This session's entry. The engine's `$.state` reads one moment per dispatch,
// so a tool.call that waited through a permission dialog would read its own
// entry from before the dialog; the module copy is the truth inside the
// process and `$.state` the mirror a hot reload restores it from
// (session.start, raised again on a reload).
let self: PartyMember = EMPTY_SELF
let nagged: string[] = []
// Timers cannot live in $.state; session.start re-arms the heartbeat.
let heartbeat: Timer | null = null
// Tool calls under way in this process, by tool_use_id: an ask inside one is a dialog.
const running = new Set<string>()
// The open waits on the person, oldest first, by the tool_use_id of the call
// that raised each. A wait ends only when its own call returns, so a parallel
// call or a subagent's call that returns first leaves it standing.
const waits = new Map<string, PartyWait>()
// A main-loop turn is running: what this session is back to once no wait is open.
let isTurnRunning = false
// Ids for a call that came without a tool_use_id.
let localIds = 0
// The heartbeat queue: writes go out in the order they were asked for.
let beating: Promise<void> = Promise.resolve()

function stopHeartbeat() {
  heartbeat?.cancel()
  heartbeat = null
}

/** Every session entry in the store, live or not. A failed read is an empty party. */
async function readEntries($: EngineInterface): Promise<Record<string, unknown>> {
  const entries: Record<string, unknown> = {}
  try {
    for (const key of await $.store.keys()) {
      if (key.startsWith(KEY_PREFIX)) entries[key] = await $.store.get(key)
    }
  } catch {
    // The store is shared decoration; a session alone still works.
  }
  return entries
}

async function readLive($: EngineInterface, now: number): Promise<PartyMember[]> {
  return liveMembers(Object.values(await readEntries($)), now)
}

async function branchOf($: EngineInterface, cwd: string): Promise<string> {
  try {
    const ran = await $.process.run(['git', '-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: GIT_TIMEOUT_MS })
    return ran.exitCode === 0 ? ran.stdout.trim() : ''
  } catch {
    return ''
  }
}

async function repoKey($: EngineInterface): Promise<string | null> {
  try {
    const repo = await $.session.repo()
    if (repo === null) return null
    return repoFromRemote(repo.remote) ?? repo.root
  } catch {
    return null
  }
}

/**
 * One heartbeat: write this session's entry, prune stale ones, refresh the
 * roster the pane draws from and the status line, and toast new long waits.
 * One at a time, so a slow write never lands after a newer one.
 */
function beat($: EngineInterface, nagMs: number): Promise<void> {
  beating = beating.then(() => beatOnce($, nagMs))
  return beating
}

async function beatOnce($: EngineInterface, nagMs: number): Promise<void> {
  try {
    const now = await $.clock.now()
    const sessionId = await $.session.id()
    self = { ...self, sessionId, beatAt: now }
    await $.state.set(SELF, self)
    await $.store.set(memberKey(sessionId), self)
    const entries = await readEntries($)
    for (const key of staleKeys(entries, now)) {
      if (key !== memberKey(sessionId)) await $.store.delete(key)
    }
    const members = liveMembers(Object.values(entries), now)
    await $.state.set(ROSTER, members)
    $.ui.status(statusLine(members))

    const due = nagDue(members, sessionId, now, nagMs, nagged)
    for (const one of due) $.ui.toast(`PARTY ▸ ${displayName(one)} WAITING ON YOU ${formatAge(now - one.since)}`)
    const liveKeys = new Set(members.map(nagKey))
    const kept = [...nagged.filter(key => liveKeys.has(key)), ...due.map(nagKey)]
    if (kept.length !== nagged.length || due.length > 0) {
      nagged = kept
      await $.state.set(NAGGED, nagged)
    }
  } catch {
    // A missed beat is made up 15 seconds later.
  }
}

/** The state the open waits and the turn add up to: the oldest wait, else working or idle. */
async function settle($: EngineInterface, nagMs: number) {
  const [oldest] = waits.values()
  const state: PartyState = oldest !== undefined ? 'waiting-on-you' : isTurnRunning ? 'working' : 'idle'
  self = withState(self, state, await $.clock.now(), oldest ?? null)
  await beat($, nagMs)
}

async function broadcast($: EngineInterface, text: string): Promise<string> {
  if (text === '') return 'Usage: /broadcast <text> sends it to every other live session.'
  const now = await $.clock.now()
  const selfId = await $.session.id()
  const targets = broadcastTargets(await readLive($, now), selfId)
  if (targets.length === 0) return 'PARTY: nobody else is online. Nothing sent.'
  const missed: string[] = []
  for (const one of targets) {
    try {
      const sent = await $.session.send({ to: { sessionId: one.sessionId }, text })
      if (!sent.isDelivered) missed.push(`${displayName(one)} (${sent.reason})`)
    } catch (error) {
      missed.push(`${displayName(one)} (${error instanceof Error ? error.message : String(error)})`)
    }
  }
  const delivered = targets.length - missed.length
  const head = `BROADCAST ▸ ${delivered}/${targets.length} DELIVERED`
  if (missed.length === 0) return head
  let copied = false
  try {
    copied = (await $.ui.copy({ text })).isCopied
  } catch {
    copied = false
  }
  const fallback = copied ? 'The text is on your clipboard to paste there.' : 'The clipboard was not available either.'
  return `${head}. Not delivered: ${missed.join(', ')}. ${fallback}`
}

export const register: Register = (on, options) => {
  const nagMs = Math.max(1, Number(options.nagMinutes ?? 5)) * 60_000
  const lockMs = Math.max(1, Number(options.lockMinutes ?? 10)) * 60_000

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: PLUGIN, description: 'party: open the raid frame of every live session', immediate: true })
      await $.command.register({
        name: 'broadcast',
        description: 'party: send a message to every other live session',
        argumentHint: '<text>',
        immediate: true,
      })
    } catch {
      $.ui.toast('PARTY: commands could not be registered')
    }
    if (self.sessionId === '') {
      // A fresh process, or a reload: pick up where the mirror left off.
      self = await read($, selfAtom)
      nagged = await read($, naggedAtom)
      isTurnRunning = self.state === 'working'
    }
    const now = await $.clock.now()
    const [branch, repo] = await Promise.all([branchOf($, e.cwd), repoKey($)])
    self = {
      ...self,
      cwd: e.cwd,
      branch,
      repo,
      since: self.since === 0 ? now : self.since,
      state: self.state === 'done' ? 'idle' : self.state,
    }
    await beat($, nagMs)
    stopHeartbeat()
    heartbeat = $.clock.every(HEARTBEAT_MS, () => void beat($, nagMs))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const title = titleFrom(e.text)
    if (self.title === '' && title !== '') self = { ...self, title }
    isTurnRunning = true
    await settle($, nagMs)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    const branch = await branchOf($, self.cwd)
    if (branch !== '') self = { ...self, branch }
    isTurnRunning = false
    await settle($, nagMs)
    return result
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id ?? `local-${(localIds += 1)}`
    self = { ...self, lastTool: e.tool }
    const kind = waitKind(e.tool)
    if (kind !== null) {
      waits.set(id, kind)
      await settle($, nagMs)
    }
    const target: PrTarget | null = e.tool === 'Bash' ? prTarget(e.command, self.repo) : null

    running.add(id)
    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(e)
    } finally {
      running.delete(id)
      // This call's dialog or question was answered: back to what else is open.
      if (waits.delete(id)) await settle($, nagMs)
    }

    if (target !== null && result.deny === undefined) {
      self = { ...self, touches: addTouch(self.touches, target, await $.clock.now(), lockMs) }
      await beat($, nagMs)
    }
    return result
  })

  on('tool.check', async ($, e, next) => {
    const decided = await next(e)
    if (decided.decision === 'deny') return decided
    let verdict = decided
    try {
      const input = e.input as { command?: unknown } | null
      if (e.tool === 'Bash' && typeof input?.command === 'string') {
        const target = prTarget(input.command, self.repo)
        if (target !== null) {
          const now = await $.clock.now()
          const selfId = await $.session.id()
          const found = otherTouch(await readLive($, now), selfId, target, now, lockMs)
          if (found !== null) verdict = { decision: 'ask', reason: lockReason(found.member, found.touch, now) }
        }
      }
      // An ask inside a call this session is running puts a dialog in front of the
      // person until that call returns (the mods API does not say when the dialog closes).
      const id = e.tool_use_id
      const isDialog = verdict.decision === 'ask' && waitKind(e.tool) === null && id !== undefined && running.has(id)
      if (isDialog && !waits.has(id)) {
        waits.set(id, 'permission')
        await settle($, nagMs)
      }
    } catch {
      // The lock is a courtesy; the engine's own verdict stands.
    }
    return verdict
  })

  on('session.end', async ($, e, next) => {
    // A /clear or a /resume ends this conversation, but the process goes on
    // under another id with no session.start: keep beating, as a fresh member.
    const goesOn = e.reason === 'clear' || e.reason === 'resume'
    if (!goesOn) stopHeartbeat()
    isTurnRunning = false
    try {
      const now = await $.clock.now()
      await $.store.set(memberKey(e.sessionId), { ...withState(self, 'done', now), sessionId: e.sessionId, beatAt: now })
      self = goesOn
        ? { ...EMPTY_SELF, cwd: self.cwd, branch: self.branch, repo: self.repo, since: now }
        : { ...withState(self, 'done', now), sessionId: e.sessionId, beatAt: now }
      await $.state.set(SELF, self)
    } catch {
      // It goes stale in two minutes anyway.
    }
    return next(e)
  })

  on('command.run', { command: 'party' }, async ($, e) => {
    await beat($, nagMs)
    try {
      await $.ui.open({ id: PANE, title: 'PARTY' })
    } catch {
      // No pane here (claude -p, VS Code): the text reply is the view.
    }
    const now = await $.clock.now()
    return { text: describeRoster(await read($, rosterAtom), await $.session.id(), now) }
  })

  on('command.run', { command: 'broadcast' }, async ($, e) => ({ text: await broadcast($, (e.args ?? '').trim()) }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const members = await read($, rosterAtom)
    const now = await $.clock.now()
    const tags = playerTags(members, self.sessionId)
    const waiting = members.filter(one => one.state === 'waiting-on-you').length
    const width = Math.max(16, e.props.bodyColumns - 24)
    const cut = (text: string) => (text.length > width ? `${text.slice(0, width - 1)}~` : text)
    const sprite = (grid: readonly string[]) =>
      halfBlockRows(grid).map(runs => (
        <Box flexDirection="row">
          {runs.map((run: PixelRun) => (
            <Text color={run.color} backgroundColor={run.backgroundColor}>
              {run.text}
            </Text>
          ))}
        </Box>
      ))

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Box key="banner" flexDirection="column" marginRight={2}>
            {sprite(BANNER)}
          </Box>
          <Box flexDirection="column">
            <Text bold color={SIGNATURE}>
              P A R T Y
            </Text>
            <Box key="summary">
              <Text color={waiting > 0 ? PICO.pink : PICO.lightGrey}>
                {members.length} IN PARTY · {waiting} WAITING ON YOU
              </Text>
            </Box>
          </Box>
        </Box>
        {members.map((one, index) => {
          const waited = now - one.since
          const isWaiting = one.state === 'waiting-on-you'
          const bar = waitBar(isWaiting ? waited : 0, nagMs, BAR_CELLS)
          const cells = barText(bar.filled, BAR_CELLS)
          const tool = one.lastTool !== '' ? ` · LAST ${one.lastTool}` : ''
          return (
            <Box key={`member-${one.sessionId}`} flexDirection="row" marginTop={1}>
              <Box key={`icon-${one.sessionId}`} flexDirection="column" marginRight={1}>
                {sprite(CLASS_ICON[one.state])}
              </Box>
              <Box flexDirection="column">
                <Box flexDirection="row">
                  <Text bold color={one.sessionId === self.sessionId ? PICO.yellow : PICO.lightGrey}>
                    {tags[index] ?? ''}{' '}
                  </Text>
                  <Text color={PICO.white}>{cut(displayName(one))}</Text>
                </Box>
                <Box flexDirection="row">
                  <Box key={`bar-${one.sessionId}`} flexDirection="row">
                    <Text color={isWaiting ? BAR_COLOR[bar.color] : PICO.darkGrey}>{cells.full}</Text>
                    <Text color={PICO.darkGrey}>{cells.empty}</Text>
                  </Box>
                  <Text color={STATE_COLOR[one.state]}> {stateText(one)}</Text>
                  <Text color={PICO.lightGrey}> {formatAge(waited)}</Text>
                </Box>
                <Text dimColor>{cut(`${place(one)}${tool}`)}</Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
