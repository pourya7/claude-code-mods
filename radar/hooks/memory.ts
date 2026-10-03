// Reads one memory file: frontmatter `name`, `description` and optional
// `triggers:` (regexes), plus body lines that state a rule. Never throws.

export type ParsedMemory = {
  file: string
  name: string
  description: string
  triggers: string[]
  rules: string[]
}

export type MemoryParse = { memory: ParsedMemory } | { problem: string } | { skip: true }

const MAX_RULES = 5
const MAX_RULE_LENGTH = 240
const RULE_WORDS = /\b(never|always|don'?t|do not|must)\b/i

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

class Malformed extends Error {}

/** Where a quoted scalar starting at 0 closes, or -1. */
const closingQuote = (text: string, quote: string): number => {
  for (let i = 1; i < text.length; i++) {
    const char = text[i]
    if (quote === '"' && char === '\\') i++
    else if (char === quote) {
      if (quote === "'" && text[i + 1] === "'") i++
      else return i
    }
  }
  return -1
}

/** One YAML scalar: plain, 'single' ('' escapes a quote) or "double" (\" and \\ escape); a trailing # comment is dropped. */
const unquote = (raw: string): string => {
  const text = raw.trim()
  const quote = text[0]
  if (quote === "'" || quote === '"') {
    const close = closingQuote(text, quote)
    if (close < 0) throw new Malformed('has an unclosed quote')
    const rest = text.slice(close + 1)
    if (rest.trim() !== '' && !/^\s+#/.test(rest)) throw new Malformed('has text after a closing quote')
    const inner = text.slice(1, close)
    return quote === "'" ? inner.replace(/''/g, "'") : inner.replace(/\\(["\\])/g, '$1')
  }
  return text.replace(/\s+#.*$/, '')
}

/** `>` / `|` with optional chomping and indent digits: a block scalar header. */
const BLOCK_SCALAR = /^[|>][+-]?\d*[+-]?$/

/**
 * A group that repeats something already repeated, such as `(\S+\s*)+` or
 * `(a*)*`: the shape that backtracks exponentially. Matching runs on every
 * tool call and cannot be interrupted, so such a trigger is refused.
 */
const NESTED_QUANTIFIER = /\((?:[^()]*(?:[+*]|\{\d*,\d*\}))[^()]*\)(?:[+*]|\{\d*,)/

/** `[a, 'b', "c"]`: splits on commas outside quotes. */
const flowList = (raw: string): string[] => {
  const inner = raw.trim().slice(1, -1)
  const items: string[] = []
  let current = ''
  let quote: string | undefined
  for (const char of inner) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined
    } else if (char === "'" || char === '"') {
      quote = char
    } else if (char === ',') {
      items.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (quote !== undefined) throw new Malformed('has an unclosed quote')
  if (current.trim() !== '') items.push(current)
  return items.map(unquote).filter(item => item !== '')
}

const cleanRule = (line: string): string =>
  line
    .trim()
    .replace(/^(?:[-*+>]|\d+[.)])\s+/, '')
    .trim()
    .slice(0, MAX_RULE_LENGTH)

const rulesOf = (body: readonly string[]): string[] =>
  body
    .filter(line => RULE_WORDS.test(line))
    .map(cleanRule)
    .filter(line => line !== '')
    .slice(0, MAX_RULES)

export const parseMemory = (file: string, text: string): MemoryParse => {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { skip: true }
  const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  const problem = (reason: string): MemoryParse => ({ problem: `${baseName(file)}: ${reason}` })
  if (close < 0) return problem('frontmatter is not closed with ---')

  const front = lines.slice(1, close)
  const fields: Record<string, string> = {}
  const triggers: string[] = []
  try {
    let listKey: string | undefined
    let block: { key: string; isFolded: boolean; lines: string[] } | undefined
    const endBlock = () => {
      if (block !== undefined) fields[block.key] = block.lines.join(block.isFolded ? ' ' : '\n')
      block = undefined
    }
    for (const [offset, line] of front.entries()) {
      const number = offset + 1
      if (block !== undefined && (line.trim() === '' || /^\s/.test(line))) {
        if (line.trim() !== '') block.lines.push(line.trim())
        continue
      }
      if (line.trim() === '' || line.trim().startsWith('#')) continue
      if (/^\s/.test(line)) {
        const item = /^\s+-\s*(.*)$/.exec(line)
        if (listKey === 'triggers' && item) triggers.push(unquote(item[1] ?? ''))
        continue
      }
      endBlock()
      const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
      if (!pair) throw new Malformed(`line ${number} is not "key: value"`)
      const key = pair[1] ?? ''
      const value = (pair[2] ?? '').trim()
      listKey = value === '' ? key : undefined
      if (BLOCK_SCALAR.test(value.replace(/\s+#.*$/, ''))) {
        if (key === 'triggers') throw new Malformed('triggers is a block scalar (| or >), not a list')
        block = { key, isFolded: value.startsWith('>'), lines: [] }
      } else if (key === 'triggers') {
        if (value.startsWith('[') && value.endsWith(']')) triggers.push(...flowList(value))
        else if (value !== '') triggers.push(unquote(value))
      } else if (value !== '') {
        fields[key] = unquote(value)
      }
    }
    endBlock()
  } catch (error) {
    return problem(error instanceof Malformed ? error.message : 'frontmatter could not be read')
  }

  const name = fields.name?.trim() ?? ''
  const description = fields.description?.trim() ?? ''
  if (name === '') return problem('frontmatter has no name')
  if (description === '') return problem('frontmatter has no description')
  for (const trigger of triggers) {
    try {
      new RegExp(trigger, 'i')
    } catch {
      return problem(`bad trigger regex ${JSON.stringify(trigger)}`)
    }
    if (NESTED_QUANTIFIER.test(trigger)) return problem(`trigger ${JSON.stringify(trigger)} nests a repeat inside a repeat, which can hang matching`)
  }

  return { memory: { file, name, description, triggers, rules: rulesOf(lines.slice(close + 1)) } }
}
