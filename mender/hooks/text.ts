// The words mender says: to the model (context notes), to you (status, list).

import type { Fact } from './learn'
import type { Repair } from './schema'
import { shortJson } from './schema'

export const repairLine = (repair: Repair): string =>
  repair.kind === 'drop'
    ? `${repair.path}: dropped (the schema allows no such key)`
    : `${repair.path}: ${repair.from} → ${repair.to} (${repair.kind})`

/** The model-visible note for a call mender repaired before it ran. */
export const repairNote = (tool: string, repairs: readonly Repair[]): string =>
  [
    `MENDER repaired the arguments of ${tool} before it ran, against the tool's input schema:`,
    ...repairs.map(repair => `- ${repairLine(repair)}`),
    'Next time send them in this shape.',
  ].join('\n')

export const factText = (fact: Fact): string => {
  const where = fact.path.join('.')
  if ('expected' in fact) return `${where === '' ? 'the arguments' : where} must be ${fact.expected}`
  return `no key ${fact.rejectKeys.join(', ')} ${where === '' ? 'at the top level' : `in ${where}`}`
}

/** The model-visible note after a schema error mender learned from. */
export const learnedNote = (tool: string, facts: readonly Fact[], repaired?: Record<string, unknown>): string =>
  [
    `MENDER: ${tool} rejected the shape of its arguments. The error says:`,
    ...facts.map(fact => `- ${factText(fact)}`),
    repaired === undefined
      ? 'mender will repair this shape on later calls.'
      : `mender will repair this shape on later calls. The same call in the right shape: ${shortJson(repaired, 600)}`,
  ].join('\n')

/** The model-visible note when a server looks down. */
export const downNote = (server: string, reason: string): string =>
  `MENDER: the MCP server "${server}" looks down (${reason}). Stop retrying its tools: tell the user to reconnect it with /mcp, then carry on.`

export type StatusCounts = { fixed: number; errors: number; down: number }

export const statusText = ({ fixed, errors, down }: StatusCounts): string | undefined => {
  const parts = [
    fixed > 0 ? `${fixed} FIXED` : '',
    errors > 0 ? `${errors} ERR` : '',
    down > 0 ? `${down} DOWN` : '',
  ].filter(part => part !== '')
  return parts.length === 0 ? undefined : `MENDER ▸ ${parts.join(' · ')}`
}

/** `mcp__notes__create_note` → `notes/create_note`. */
export const shortTool = (tool: string): string => {
  if (!tool.startsWith('mcp__')) return tool
  const [, server = '', ...rest] = tool.split('__')
  return `${server}/${rest.join('__')}`
}

export const clockText = (at: number): string => {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** One line, at most `max` characters. */
export const oneLine = (text: string, max = 80): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
