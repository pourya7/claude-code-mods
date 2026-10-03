import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { StanceSource, StanceState } from '../types'
import { autoSwitch, detectStance } from './detect'
import { checkToolCall } from './policy'
import { BADGES, spriteRows } from './sprites'
import { STANCES, STANCE_INFO, modelNote, parseStance } from './stances'
import type { Stance } from './stances'

const current = atom({ plugin: 'stance', key: 'current' } as const, { stance: 'build', source: 'default' } as StanceState)

const PERSON_ORIGINS = new Set(['composer', 'bridge', 'sdk'])
const LABEL_PINK = '#FF77A8'
const LIGHT_GREY = '#C2C3C7'

const statusText = (stance: Stance): string | undefined =>
  stance === 'build' ? undefined : `STANCE ▶ ${STANCE_INFO[stance].title}`

/** The person chose `stance` with /stance or a band button. */
const choose = async ($: EngineInterface, stance: Stance): Promise<void> => {
  await update($, current, () => ({ stance, source: 'person', personStance: stance }))
  $.ui.status(statusText(stance))
}

/** Auto-detect switched to `stance`; the person's own choice stays the floor. */
const autoSet = async ($: EngineInterface, stance: Stance): Promise<void> => {
  await update($, current, state => ({ stance, source: 'auto', personStance: state.personStance }))
  $.ui.status(statusText(stance))
}

const SOURCE_LABEL: Record<StanceSource, string> = { default: ' (default)', person: ' (set by you)', auto: ' (auto-detected)' }

/** The session's TMPDIR as an extra temp root; none when it cannot be read. */
const tempRootsOf = async ($: EngineInterface): Promise<string[]> => {
  try {
    const tmpdir = await $.env.get('TMPDIR')
    return tmpdir ? [tmpdir] : []
  } catch {
    return []
  }
}

const usage = `Usage: /stance [${STANCES.join('|')}]`

export const register: Register = (on, options) => {
  const isAutoDetect = options.autoDetect !== false
  const isBuildShown = options.showBuild === true

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'stance',
      description: 'Show or switch the session stance (investigate, draft, build, ship)',
      argumentHint: '[investigate|draft|build|ship]',
      immediate: true,
    })
    const { stance } = await read($, current)
    $.ui.status(statusText(stance))
    return next(e)
  })

  on('command.run', { command: 'stance' }, async ($, e) => {
    const wanted = e.args.trim()
    if (wanted === '') {
      const { stance, source } = await read($, current)
      const info = STANCE_INFO[stance]
      return { text: `STANCE: ${info.title}${SOURCE_LABEL[source]} - ${info.tagline}\n${usage}` }
    }
    const stance = parseStance(wanted)
    if (stance === undefined) return { text: `Unknown stance "${wanted}". ${usage}` }
    await choose($, stance)
    const info = STANCE_INFO[stance]
    const note = modelNote(stance) ?? '[stance] The session is back in BUILD stance: no restrictions from the stance mod.'
    return { text: `STANCE → ${info.title}. ${info.tagline}`, context: [note] }
  })

  on('prompt.submit', async ($, e, next) => {
    if (isAutoDetect && PERSON_ORIGINS.has(e.origin.kind)) {
      const detected = detectStance(e.text)
      const state = await read($, current)
      const decision = detected === undefined ? undefined : autoSwitch(state, detected)
      if (decision !== undefined && 'to' in decision) {
        await autoSet($, decision.to)
        $.ui.toast(`STANCE → ${STANCE_INFO[decision.to].title}`)
      } else if (decision !== undefined) {
        $.ui.toast(`STANCE KEPT: ${STANCE_INFO[decision.kept].title} (SET BY YOU)`)
      }
    }
    const { stance } = await read($, current)
    const note = modelNote(stance)
    return next(note === undefined ? e : { ...e, context: [...(e.context ?? []), note] })
  })

  on('tool.call', async ($, e, next) => {
    const { stance } = await read($, current)
    if (stance === 'build') return next(e)
    if (e.tool === 'Agent') {
      const note = modelNote(stance)
      return next(note === undefined ? e : { ...e, prompt: `${note}\n\n${e.prompt}` })
    }
    const verdict = checkToolCall(stance, e, { tempRoots: await tempRootsOf($) })
    return verdict === undefined ? next(e) : { deny: verdict }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { stance } = await read($, current)
    if (e.props.hasSurvey || (stance === 'build' && !isBuildShown)) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const info = STANCE_INFO[stance]
    const badge = spriteRows(BADGES[stance])

    return (
      <Box key="band" flexDirection="row" gap={2}>
        <Box key="badge" flexDirection="column">
          {badge.map((runs, row) => (
            <Box key={`badge-${row}`} flexDirection="row">
              {runs.map((run, index) => (
                <Text color={run.color} backgroundColor={run.backgroundColor}>
                  {run.text}
                </Text>
              ))}
            </Box>
          ))}
        </Box>
        <Box key="info" flexDirection="column">
          <Box key="title-row" flexDirection="row">
            <Text color={LABEL_PINK} bold>
              {'STANCE ★ '}
            </Text>
            <Box key="stance-name">
              <Text color={info.color} bold>
                {info.title}
              </Text>
            </Box>
          </Box>
          <Box key="tagline">
            <Text color={LIGHT_GREY} wrap="truncate-end">
              {info.tagline}
            </Text>
          </Box>
          <Box key="buttons" flexDirection="row" gap={1}>
            {STANCES.map(option => (
              <Button
                key={`to-${option}`}
                label={STANCE_INFO[option].short}
                hotkey={option[0]}
                variant={option === stance ? 'primary' : undefined}
                onPress={() => choose($, option)}
              />
            ))}
          </Box>
        </Box>
      </Box>
    )
  })
}
