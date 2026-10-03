// `/tripwire add <sentence>`: the prompt that asks a model to propose one rule,
// and the parser that turns its reply into a validated rule or a reason.
import { validateRule } from './rules'
import type { Rule } from './rules'

export const COMPILE_SYSTEM =
  'You compile one plain-English engineering rule into one JSON rule for a Claude Code tool-call guard. Reply with the JSON object only.'

export const COMPILE_EXAMPLES: { sentence: string; rule: Rule }[] = [
  {
    sentence: 'Never force push; a lease is fine.',
    rule: {
      id: 'no-force-push',
      tool: 'Bash',
      match: String.raw`\bgit\s+push\b[^;&|\n]*\s(?:--force|-f)(?=\s|$)`,
      field: 'command',
      action: 'deny',
      message: 'Force pushes rewrite shared history. Use --force-with-lease.',
    },
  },
  {
    sentence: 'Always ask me before anything touches api.example.com.',
    rule: {
      id: 'ask-before-example-api',
      tool: '*',
      match: String.raw`api\.example\.com`,
      action: 'ask',
      message: 'api.example.com is protected. Confirm first.',
    },
  },
  {
    sentence: 'Use pnpm, not npm, for installs.',
    rule: {
      id: 'pnpm-not-npm',
      tool: 'Bash',
      match: String.raw`\bnpm\s+(install|i)\b`,
      field: 'command',
      action: 'rewrite',
      replace: 'pnpm install',
      message: 'This repo installs with pnpm.',
    },
  },
]

const SCHEMA = `{
  "id": "kebab-case-name",
  "tool": "a tool name (Bash, Edit, Write, Read, WebFetch, ...), a glob such as mcp__*, or *",
  "match": "a JavaScript regular expression tested against the field",
  "field": "optional: which input field to test (Bash: command; Edit/Write/Read: file_path; WebFetch: url). Left out, the whole input as JSON",
  "action": "deny | ask | rewrite | note",
  "message": "one sentence the model reads when the rule fires",
  "cite": "optional: where the rule was written down",
  "replace": "only for action rewrite: the replacement text ($1 works)"
}`

/** The one-message prompt: the schema, three worked examples, then the sentence. */
export const buildCompilePrompt = (sentence: string): string =>
  [
    'Rule schema:',
    SCHEMA,
    '',
    'deny refuses the call, ask forces a permission prompt, rewrite changes the field before it runs (it needs "field" and "replace"), note lets the call run and tells the model the message.',
    'Prefer deny for "never", ask for "check with me", rewrite for "use X instead of Y", note for reminders.',
    '',
    ...COMPILE_EXAMPLES.flatMap(example => [
      `Sentence: ${example.sentence}`,
      `Rule: ${JSON.stringify(example.rule)}`,
      '',
    ]),
    `Sentence: ${sentence}`,
    'Rule:',
  ].join('\n')

export type Proposal = { rule: Rule } | { reason: string }

const jsonCandidate = (text: string): string | undefined => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = fenced?.[1] ?? text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  return start === -1 || end <= start ? undefined : body.slice(start, end + 1)
}

/** Parses the model's reply: a valid rule, or why it is not one. Never throws. */
export const parseProposal = (text: string): Proposal => {
  const candidate = jsonCandidate(text)
  if (candidate === undefined) return { reason: 'the model did not reply with a JSON object' }
  let data: unknown
  try {
    data = JSON.parse(candidate)
  } catch (error) {
    return { reason: `the reply is not valid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  const checked = validateRule(data, 0)
  return 'problem' in checked ? { reason: checked.problem } : { rule: checked.rule }
}

/** `id`, or `id-2`, `id-3`... when the id is taken. */
export const uniqueId = (id: string, taken: readonly string[]): string => {
  if (!taken.includes(id)) return id
  let n = 2
  while (taken.includes(`${id}-${n}`)) n += 1
  return `${id}-${n}`
}
