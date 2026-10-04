#!/usr/bin/env node
// A tiny stand-in MCP server for demos: a shopping cart with strict input
// schemas, so a demo can show what happens to arguments of the wrong shape.
// It fakes a real MCP server (no network, no dependencies): JSON-RPC 2.0 over
// stdio, one message per line, answering initialize, ping, tools/list and
// tools/call. The cart lives in memory and is gone when the process exits.
//
//   node demos/mcp/cart-server.js               run as an MCP server (stdio)
//   node demos/mcp/cart-server.js --tools-list  print {"servers":{"cart":<tools/list answer>}}
//
// With CART_SERVER_LOG=<file>, each tools/call's name and arguments, exactly as
// they arrived, are appended to that file as one JSON line.
//
// Arguments are validated strictly: a wrong type or an unknown key is
// refused with an "Input validation error", the way MCP SDK servers do.

const { appendFileSync } = require('node:fs')

const TOOLS = [
  {
    name: 'add_item',
    description: 'Add a product to the cart.',
    inputSchema: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'Product code, e.g. MUG-01' },
        qty: { type: 'integer', minimum: 1, description: 'How many' },
        gift: { type: 'boolean', description: 'Gift-wrap this line' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Labels for this line' },
      },
      required: ['sku', 'qty'],
      additionalProperties: false,
    },
  },
  {
    name: 'view_cart',
    description: 'List the lines in the cart.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

if (process.argv.includes('--tools-list')) {
  process.stdout.write(`${JSON.stringify({ servers: { cart: { tools: TOOLS } } }, null, 2)}\n`)
  process.exit(0)
}

const lines = []

const typeOf = value =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value

const fits = (type, value) => {
  const actual = typeOf(value)
  return actual === type || (type === 'number' && actual === 'integer')
}

/** The problems with `args` against a flat object schema, as validator messages. */
const validate = (schema, args) => {
  if (typeOf(args) !== 'object') return ['arguments must be object']
  const problems = []
  for (const key of schema.required ?? []) if (!(key in args)) problems.push(`${key} is required`)
  for (const [key, value] of Object.entries(args)) {
    const property = schema.properties[key]
    if (property === undefined) {
      if (schema.additionalProperties === false) problems.push(`must NOT have additional property '${key}'`)
      continue
    }
    if (!fits(property.type, value)) problems.push(`${key} must be ${property.type}`)
    else if (property.items !== undefined && value.some(item => !fits(property.items.type, item)))
      problems.push(`${key} items must be ${property.items.type}`)
    else if (property.minimum !== undefined && value < property.minimum) problems.push(`${key} must be >= ${property.minimum}`)
  }
  return problems
}

const lineText = line =>
  `${line.qty} x ${line.sku}${line.gift ? ' (gift-wrapped)' : ''}${line.tags.length > 0 ? ` [${line.tags.join(', ')}]` : ''}`

const text = (body, isError = false) => ({ content: [{ type: 'text', text: body }], ...(isError ? { isError: true } : {}) })

const callTool = (name, args) => {
  const tool = TOOLS.find(one => one.name === name)
  if (tool === undefined) return text(`Unknown tool: ${name}`, true)
  const problems = validate(tool.inputSchema, args ?? {})
  if (problems.length > 0) return text(`Input validation error: ${problems.join('; ')}`, true)
  if (name === 'add_item') {
    lines.push({ sku: args.sku, qty: args.qty, gift: args.gift === true, tags: args.tags ?? [] })
    return text(`Added ${lineText(lines.at(-1))}. The cart has ${lines.length} line${lines.length === 1 ? '' : 's'}.`)
  }
  if (lines.length === 0) return text('The cart is empty.')
  return text(lines.map(lineText).join('\n'))
}

const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)

const handle = message => {
  const { id, method, params } = message
  if (id === undefined) return // A notification, such as notifications/initialized.
  switch (method) {
    case 'initialize':
      return send({
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'cart', version: '0.1.0' },
        },
      })
    case 'ping':
      return send({ id, result: {} })
    case 'tools/list':
      return send({ id, result: { tools: TOOLS } })
    case 'tools/call':
      if (process.env.CART_SERVER_LOG) {
        try {
          appendFileSync(process.env.CART_SERVER_LOG, `${JSON.stringify({ name: params?.name, arguments: params?.arguments })}\n`)
        } catch {
          // The log is a debugging aid only.
        }
      }
      return send({ id, result: callTool(params?.name, params?.arguments) })
    default:
      return send({ id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let newline
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line === '') continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      send({ id: null, error: { code: -32700, message: 'Parse error' } })
      continue
    }
    handle(message)
  }
})
process.stdin.on('end', () => process.exit(0))
