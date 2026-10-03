/** Single-quotes a path for a POSIX shell; embedded quotes become '\''. */
export const shellQuote = (path: string): string => `'${path.replace(/'/g, `'\\''`)}'`

/** The exact prefix every anchored Bash command starts with. */
export const anchorPrefix = (anchor: string): string => `cd ${shellQuote(anchor)} && `

/**
 * Prefixes `command` with a cd into the anchor, unless it already starts with
 * that exact prefix. The command goes in a `{ ...\n}` group so the cd binds to
 * all of it: `cd X && a & b` would run `b` outside X, since `&` ends the whole
 * `&&` list. The newline before `}` keeps a trailing comment or heredoc from
 * swallowing the brace.
 */
export const rewriteCommand = (command: string, anchor: string): string => {
  const prefix = anchorPrefix(anchor)

  return command.startsWith(prefix) ? command : `${prefix}{ ${command}\n}`
}
