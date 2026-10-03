import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RadarMemory, RadarPing } from '../types'
import { buildIndex, callText, findMatches, touchesSources } from './match'
import type { Match } from './match'
import { parseMemory } from './memory'
import type { ParsedMemory } from './memory'
import { PALETTE, pixelRows, sweepGrid } from './pixels'
import { clockText, contextText, defaultMemoryDir, memoryDirsOf, statusText, titleText } from './text'

type Engine = EngineInterface

const PLUGIN = 'radar'
const PANE = 'radar'
const MAX_PINGS = 20
const MAX_FILES = 2000
const MAX_LISTED = 40

const memoriesAtom = atom({ plugin: 'radar', key: 'memories' } as const, [])
const problemsAtom = atom({ plugin: 'radar', key: 'problems' } as const, [])
const sourcesAtom = atom({ plugin: 'radar', key: 'sources' } as const, [])
const pingsAtom = atom({ plugin: 'radar', key: 'pings' } as const, [])
const pingCountAtom = atom({ plugin: 'radar', key: 'pingCount' } as const, 0)
const attachedAtom = atom({ plugin: 'radar', key: 'attached' } as const, [])

const USAGE = [
  'usage: /radar           open the RADAR pane',
  '       /radar list      the index, the recent pings and any skipped files, as text',
  '       /radar reload    read the memory folders again',
].join('\n')

const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`

/** The tool's own arguments, without the envelope's keys (`consent` is the person's press text, not an argument). */
const argumentsOf = (e: Record<string, unknown>): Record<string, unknown> => {
  const { tool: _tool, tool_use_id: _id, agentId: _agent, consent: _consent, ...rest } = e
  return rest
}

const showStatus = async ($: Engine) => {
  $.ui.status(statusText((await read($, memoriesAtom)).length, await read($, pingCountAtom)))
}

const sourcesOf = async ($: Engine, option: unknown): Promise<{ dirs: string[]; isExplicit: boolean }> => {
  const home = await $.env.get('HOME')
  const explicit = memoryDirsOf(option, home)
  if (explicit.length > 0) return { dirs: explicit, isExplicit: true }
  const settings = await $.settings.read().catch(() => ({}))
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const root = await $.session.root().catch(() => $.session.cwd())
  return { dirs: [defaultMemoryDir(settings, home, configDir, root)], isExplicit: false }
}

/** Reads every *.md directly in each folder; the bad ones become problems and one toast. Never writes. */
const loadIndex = async ($: Engine, option: unknown) => {
  const { dirs, isExplicit } = await sourcesOf($, option)
  const parsed: ParsedMemory[] = []
  const badFiles: string[] = []
  const missing: string[] = []
  const seen = new Set<string>()
  for (const dir of dirs) {
    const entries = await $.fs.list(dir).catch(() => undefined)
    if (entries === undefined) {
      if (isExplicit) missing.push(dir)
      continue
    }
    const files = entries
      .filter(entry => (entry.kind === 'file' || entry.isLink) && entry.name.toLowerCase().endsWith('.md'))
      .map(entry => `${dir}/${entry.name}`)
      .sort()
    for (const file of files) {
      if (seen.has(file) || seen.size >= MAX_FILES) continue
      seen.add(file)
      let text: string
      try {
        text = await $.fs.read(file)
      } catch {
        badFiles.push(`${file.slice(file.lastIndexOf('/') + 1)}: could not be read`)
        continue
      }
      const outcome = parseMemory(file, text)
      if ('memory' in outcome) parsed.push(outcome.memory)
      else if ('problem' in outcome) badFiles.push(outcome.problem)
    }
  }
  const memories: RadarMemory[] = buildIndex(parsed)
  await $.state.set({ plugin: 'radar', key: 'memories' }, memories)
  await $.state.set({ plugin: 'radar', key: 'problems' }, [...badFiles, ...missing.map(dir => `folder not found: ${dir}`)])
  await $.state.set({ plugin: 'radar', key: 'sources' }, dirs)
  const parts = [
    ...(badFiles.length > 0 ? [`${plural(badFiles.length, 'MEMORY FILE', 'MEMORY FILES')} SKIPPED`] : []),
    ...(missing.length > 0 ? [`${plural(missing.length, 'FOLDER', 'FOLDERS')} NOT FOUND`] : []),
  ]
  if (parts.length > 0) $.ui.toast(`RADAR ▸ ${parts.join(' · ')} · /radar`)
  await showStatus($)
}

const summaryText = async ($: Engine): Promise<string> => {
  const memories = await read($, memoriesAtom)
  const problems = await read($, problemsAtom)
  const sources = await read($, sourcesAtom)
  const pings = await read($, pingsAtom)
  const count = await read($, pingCountAtom)
  const lines = [titleText(memories.length), `${plural(memories.length, 'memory', 'memories')} · ${plural(count, 'ping')} this session`]
  lines.push(`Folders: ${sources.join(', ') || '(none)'}`)
  if (memories.length === 0) lines.push('  no memory files with name/description frontmatter found there')
  for (const memory of memories.slice(0, MAX_LISTED)) lines.push(`  ◉ ${memory.name}: ${memory.description}`)
  if (memories.length > MAX_LISTED) lines.push(`  … and ${memories.length - MAX_LISTED} more`)
  if (pings.length > 0) {
    lines.push('Recent pings:')
    for (const ping of [...pings].reverse()) lines.push(`  ${clockText(ping.at)}  ${ping.tool.toUpperCase()}  ${ping.memory}`)
  }
  if (problems.length > 0) {
    lines.push(`Skipped (${problems.length}):`)
    for (const problem of problems) lines.push(`  ${problem}`)
  }
  return lines.join('\n')
}

const openPane = async ($: Engine) => {
  try {
    await $.ui.open({ id: PANE, title: titleText((await read($, memoriesAtom)).length) })
  } catch {
    // An open that throws (a surface or hook refused it) leaves the command's text reply, which says the same.
  }
}

/** Claims the matches not yet attached this turn, records the pings, and returns the claimed ones. */
const recordPings = async ($: Engine, tool: string, matches: readonly Match[], isToastOn: boolean): Promise<Match[]> => {
  let claimed: Match[] = []
  await update($, attachedAtom, attached => {
    // update() may run this again on a version miss: the last run decides.
    claimed = matches.filter(match => !attached.includes(match.memory.file))
    return [...attached, ...claimed.map(match => match.memory.file)]
  })
  if (claimed.length === 0) return claimed
  const at = await $.clock.now()
  const fresh: RadarPing[] = claimed.map(match => ({ at, tool, memory: match.memory.name, reason: match.reason }))
  await update($, pingsAtom, pings => [...pings, ...fresh].slice(-MAX_PINGS))
  await update($, pingCountAtom, count => count + fresh.length)
  if (isToastOn) for (const ping of fresh) $.ui.toast(`RADAR ▸ ${ping.memory}`)
  await showStatus($)
  return claimed
}

export const register: Register = (on, options) => {
  const isToastOn = options.toast !== false

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: PLUGIN,
        description: 'Show the memory radar: the index and recent pings; /radar reload re-reads the folders',
        argumentHint: '[list | reload]',
      })
    } catch {
      $.ui.toast('RADAR ▸ /radar could not be registered')
    }
    try {
      await loadIndex($, options.memoryDirs)
    } catch {
      $.ui.toast('RADAR ▸ the memory folders could not be read')
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    try {
      await $.state.set({ plugin: 'radar', key: 'attached' }, [])
    } catch {
      // A stale list only means a memory waits a turn to come back.
    }
    return next(e)
  })

  on('command.run', { command: PLUGIN }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === '') {
      await openPane($)
      return { text: await summaryText($) }
    }
    if (word === 'list') return { text: await summaryText($) }
    if (word === 'reload') {
      await loadIndex($, options.memoryDirs)
      return { text: await summaryText($) }
    }
    return { text: USAGE }
  })

  on('tool.call', async ($, e, next) => {
    let matches: Match[] = []
    try {
      const memories = await read($, memoriesAtom)
      if (memories.length > 0) {
        const text = callText(e.tool, argumentsOf(e as unknown as Record<string, unknown>))
        // A call on the memory files themselves (a read, an edit, the engine's own memory writer) is not about them.
        const isOnMemories = touchesSources(text, await read($, sourcesAtom), await $.env.get('HOME'))
        matches = isOnMemories ? [] : findMatches(memories, text, await read($, attachedAtom))
      }
    } catch {
      matches = []
    }
    const ran = await next(e)
    if (matches.length === 0 || ran.deny !== undefined) return ran
    let claimed: Match[]
    try {
      claimed = await recordPings($, e.tool, matches, isToastOn)
    } catch {
      return ran
    }
    if (claimed.length === 0) return ran
    const notes = claimed.map(match => contextText(match.memory, match.reason, match.hits))
    return { ...ran, context: [...(ran.context ?? []), ...notes] } as typeof ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const memories = await read($, memoriesAtom)
    const problems = await read($, problemsAtom)
    const sources = await read($, sourcesAtom)
    const pings = await read($, pingsAtom)
    const count = await read($, pingCountAtom)
    const width = Math.max(24, e.props.bodyColumns)
    const scope = pixelRows(sweepGrid(count, Math.min(3, pings.length)))

    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row" gap={2}>
          <Box flexDirection="column">
            {scope.map((runs, y) => (
              <Box key={`scope-row-${y}`} flexDirection="row">
                {runs.map(cell => (
                  <Text color={cell.color} backgroundColor={cell.backgroundColor}>
                    {cell.text}
                  </Text>
                ))}
              </Box>
            ))}
          </Box>
          <Box flexDirection="column" flexShrink={1}>
            <Text bold color={PALETTE.v}>
              {titleText(memories.length)}
            </Text>
            <Text color={PALETTE.i}>{`${count} ${count === 1 ? 'PING' : 'PINGS'} THIS SESSION`}</Text>
            <Text color={PALETTE.d}>SCANNING</Text>
            {sources.map(dir => (
              <Text color={PALETTE.l} wrap="truncate-start">
                {dir}
              </Text>
            ))}
            <Box flexDirection="row" marginTop={1}>
              <Button key="radar-reload" label="RELOAD" onPress={() => loadIndex($, options.memoryDirs)} />
            </Box>
          </Box>
        </Box>
        <Text color={PALETTE.d}>{'─'.repeat(Math.min(width, 60))}</Text>
        {pings.length === 0 && <Text color={PALETTE.l}>NO PINGS YET · THE SCOPE IS QUIET</Text>}
        {[...pings].reverse().map((ping, i) => (
          <Box key={`ping-${i}`} flexDirection="row">
            <Text color={PALETTE.d}>{`${clockText(ping.at)}  ${ping.tool.toUpperCase()}  `}</Text>
            <Text color={ping.reason === 'trigger' ? PALETTE.i : PALETTE.v}>{ping.reason === 'trigger' ? '◆ ' : '● '}</Text>
            <Text color={PALETTE.w} wrap="truncate-end">
              {ping.memory}
            </Text>
          </Box>
        ))}
        {problems.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color={PALETTE.o}>{`SKIPPED: ${problems.length}`}</Text>
            {problems.map(problem => (
              <Text color={PALETTE.o} wrap="truncate-end">{`▸ ${problem}`}</Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
