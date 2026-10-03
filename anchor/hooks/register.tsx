import type { EngineInterface, Register, ToolCallInput, ToolCallResult } from 'claude-code'

import type { AnchorPoint } from '../types'
import {
  ANCHOR_SPRITE,
  BLUE,
  GLYPH,
  SPRITE_PALETTE,
  SPRITE_PALETTE_OFF,
  replyLines,
  splitLine,
  statusText,
} from './describe'
import { REAL_PWD, REV_PARSE, SHOW_BRANCH, readGitDirs } from './git'
import { gitWriteTarget } from './guard'
import { baseName, isInsideAny, resolvePath, respeller } from './paths'
import { rewriteCommand } from './shell'
import { spriteRows } from './sprite'

type Engine = EngineInterface

const current = { plugin: 'anchor', key: 'current' } as const
const agents = { plugin: 'anchor', key: 'agents' } as const

/** The output of `argv` run in `cwd`, or null when it fails. */
const output = async ($: Engine, argv: readonly string[], cwd: string): Promise<string | null> => {
  const run = await $.process.run([...argv], { cwd, timeoutMs: 10_000 }).catch(() => null)

  return run?.exitCode === 0 ? run.stdout.trim() : null
}

/**
 * Asks git where `path` sits; outside git (or with git failing) it anchors bare.
 * Git prints paths with symlinks resolved, so they are spelled back the way
 * `path` spells them (and the resolved spelling is kept beside, for the guard).
 */
const locate = async ($: Engine, path: string): Promise<AnchorPoint> => {
  const bare: AnchorPoint = { isOn: true, path, root: path, primary: null, name: baseName(path), branch: null }
  try {
    const dirs = await $.process.run([...REV_PARSE], { cwd: path, timeoutMs: 10_000 })
    if (dirs.exitCode !== 0) return bare
    const real = readGitDirs(dirs.stdout, path)
    const physical = await output($, REAL_PWD, path)
    const respell = physical ? respeller(physical, path) : (dir: string) => dir
    const root = respell(real.root)
    const primary = real.primary ? respell(real.primary) : null
    const branch = (await output($, SHOW_BRANCH, path)) || null
    const point: AnchorPoint = { isOn: true, path, root, primary, name: baseName(root), branch }
    if (real.root !== root) point.realRoot = real.root
    if (real.primary !== primary) point.realPrimary = real.primary

    return point
  } catch {
    return bare
  }
}

/** Every spelling of the anchor's worktree and of its primary checkout. */
const spellings = (point: AnchorPoint) => ({
  roots: [point.root, point.realRoot].filter((dir): dir is string => Boolean(dir)),
  primaries: [point.primary, point.realPrimary].filter((dir): dir is string => Boolean(dir)),
})

/** Shows the anchor on the status line, or clears it while off. */
const showStatus = ($: Engine, point: AnchorPoint | null) =>
  $.ui.status(point?.isOn ? statusText(point) : undefined)

/** The anchor as it stands, when it is on. */
const activeAnchor = async ($: Engine): Promise<AnchorPoint | null> => {
  const { value } = await $.state.get(current)

  return value?.isOn ? value : null
}

/** Records the anchor for the session and shows it on the status line. */
const save = async ($: Engine, point: AnchorPoint) => {
  await $.state.set(current, point)
  showStatus($, point)
}

/**
 * Agent tool calls that asked for an isolated worktree (or a remote run), by
 * tool_use_id, from the call until its spawn. Short-lived, so a module value.
 */
const isolatedCalls = new Set<string>()

/** Rewrites a Bash call into `point` and guards it, or guards an edit. */
async function enforce(
  $: Engine,
  e: ToolCallInput,
  next: (e: ToolCallInput) => Promise<ToolCallResult>,
  point: AnchorPoint,
  isGuarded: boolean,
): Promise<ToolCallResult> {
  const { roots, primaries } = spellings(point)
  const isGuarding = isGuarded && primaries.length > 0

  if (e.tool === 'Bash') {
    const command = rewriteCommand(e.command, point.path)
    const write = isGuarding ? gitWriteTarget(command, point.path, primaries, roots) : null
    if (write) {
      $.ui.toast(`${GLYPH} ANCHOR BLOCKED GIT ${write.verb.toUpperCase()} IN PRIMARY`)

      return {
        deny:
          `anchor: \`git ${write.verb}\` would run in the primary checkout ${write.dir}, ` +
          `outside the anchored worktree ${point.root}. Run it inside the anchor, ` +
          `or have the user run /anchor off to lift the guard.`,
      }
    }

    return next({ ...e, command })
  }

  if (e.tool !== 'Edit' && e.tool !== 'Write' && e.tool !== 'NotebookEdit') return next(e)
  const target = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
  const path = resolvePath(target, point.path)
  if (isGuarding && isInsideAny(path, primaries) && !isInsideAny(path, roots)) {
    $.ui.toast(`${GLYPH} ANCHOR BLOCKED ${e.tool.toUpperCase()} IN PRIMARY`)

    return {
      deny:
        `anchor: ${path} is in the primary checkout ${point.primary}, outside the anchored ` +
        `worktree ${point.root}. Edit the copy under ${point.root} instead, ` +
        `or have the user run /anchor off to lift the guard.`,
    }
  }

  return next(e)
}

export const register: Register = (on, options) => {
  const isGuarded = options.protectPrimary !== false

  const reply = (point: AnchorPoint | null) => ({ text: replyLines(point, isGuarded).join('\n') })

  on('session.start', async ($, e, next) => {
    await $.command
      .register({
        name: 'anchor',
        description: 'Show the worktree anchor; /anchor <path> re-anchors, /anchor off disables',
        argumentHint: '[path | off | on]',
      })
      .catch(() => $.ui.toast(`${GLYPH} ANCHOR: could not register /anchor`))
    // session.start runs again on an enable, a worker respawn or a reload:
    // keep the anchor the session already has (off, or moved by /anchor <path>).
    const { value: kept } = await $.state.get(current)
    if (kept) showStatus($, kept)
    else await save($, await locate($, e.cwd))

    return next(e)
  })

  on('command.run', { command: 'anchor' }, async ($, e) => {
    const args = e.args.trim()
    const { value: point = null } = await $.state.get(current)

    if (args === '') return reply(point)

    if (args === 'off') {
      const off = point ? { ...point, isOn: false } : null
      if (off) await save($, off)
      else showStatus($, null)

      return reply(off)
    }

    if (args === 'on' && point) {
      await save($, { ...point, isOn: true })

      return reply({ ...point, isOn: true })
    }

    const base = point?.path ?? (await $.session.cwd())
    const target = resolvePath(args.replace(/^(['"])(.*)\1$/, '$2'), base)
    const stat = await $.fs.stat(target).catch(() => null)
    if (stat?.kind !== 'dir') return { text: `${GLYPH} ANCHOR: no such directory ${target}` }

    const moved = await locate($, target)
    await save($, moved)

    return reply(moved)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Agent') {
      if (e.isolation && e.tool_use_id) isolatedCalls.add(e.tool_use_id)

      return next(e)
    }
    if (e.tool !== 'Bash' && e.tool !== 'Edit' && e.tool !== 'Write' && e.tool !== 'NotebookEdit') {
      return next(e)
    }
    const point = await activeAnchor($)
    if (!point) return next(e)
    if (e.agentId === undefined) return enforce($, e, next, point, isGuarded)

    // A subagent shares the session's anchor unless it was spawned with a
    // directory of its own: its own cwd anchors it there, isolation frees it.
    const { value: own } = await $.state.get({ ...agents, id: e.agentId })
    if (!own) return enforce($, e, next, point, isGuarded)

    return own.point ? enforce($, e, next, own.point, isGuarded) : next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const isIsolated = isolatedCalls.delete(e.tool_use_id)
    const spawned = await next(e)
    if (!spawned.agentId) return spawned

    if (isIsolated) {
      await $.state.set({ ...agents, id: spawned.agentId }, { point: null })
    } else if (e.cwd) {
      const { value: anchor } = await $.state.get(current)
      const point = await locate($, resolvePath(e.cwd, anchor?.path ?? (await $.session.cwd())))
      await $.state.set({ ...agents, id: spawned.agentId }, { point })
    } else if (e.parentAgentId !== undefined) {
      // A subagent's own subagent starts where its parent runs.
      const { value: parent } = await $.state.get({ ...agents, id: e.parentAgentId })
      if (parent) await $.state.set({ ...agents, id: spawned.agentId }, parent)
    }

    return spawned
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'anchor' } }, ($, e, next) => {
    if (e.props.isErrored) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const [title = '', ...rest] = e.props.text.split('\n')
    const isOff = !title.includes('ANCHOR SET')
    const sprite = spriteRows(ANCHOR_SPRITE, isOff ? SPRITE_PALETTE_OFF : SPRITE_PALETTE)

    return (
      <Box flexDirection="row" gap={2}>
        <Box flexDirection="column" flexShrink={0}>
          {sprite.map((runs, row) => (
            <Box key={`sprite-${row}`} flexDirection="row">
              {runs.map((run, index) => (
                <Text color={run.color} backgroundColor={run.backgroundColor}>
                  {run.text}
                </Text>
              ))}
            </Box>
          ))}
        </Box>
        <Box flexDirection="column" flexShrink={1}>
          <Text bold color={isOff ? '#83769C' : BLUE}>
            {title}
          </Text>
          {rest.map((line, index) => {
            const { label, value } = splitLine(line)

            return (
              <Box key={`line-${index}`} flexDirection="row" gap={1}>
                <Text color={isOff ? '#83769C' : BLUE}>{label.padEnd(7)}</Text>
                <Text wrap="truncate-middle">{value}</Text>
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })
}
