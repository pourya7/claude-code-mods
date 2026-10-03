/** Collapses `.`, `..`, repeated and trailing slashes of an absolute path. */
export const normalizePath = (path: string): string => {
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }

  return `/${segments.join('/')}`
}

/** Resolves `path` against `base` when relative, then normalizes it. */
export const resolvePath = (path: string, base: string): string =>
  normalizePath(path.startsWith('/') ? path : `${base}/${path}`)

/** True when `path` is `root` or lies beneath it (whole segments only). */
export const isInside = (path: string, root: string): boolean => {
  const target = normalizePath(path)
  const top = normalizePath(root)

  return target === top || top === '/' || target.startsWith(`${top}/`)
}

/** The directory holding `path`. */
export const parentOf = (path: string): string => normalizePath(`${normalizePath(path)}/..`)

/** The last segment of `path`. */
export const baseName = (path: string): string => normalizePath(path).split('/').pop() || '/'

/** True when `path` lies in any of `roots`. */
export const isInsideAny = (path: string, roots: readonly string[]): boolean =>
  roots.some(root => isInside(path, root))

/**
 * Maps paths from their resolved spelling (`real`, what git prints) back to
 * the spelling the session uses (`logical`, its cwd through a symlink).
 * The two share a tail of segments; the parts before it are the link and its
 * target, and any path under the target is re-spelled under the link.
 * A path outside the target comes back unchanged.
 */
export const respeller = (real: string, logical: string): ((path: string) => string) => {
  const realParts = normalizePath(real).split('/').filter(Boolean)
  const logicalParts = normalizePath(logical).split('/').filter(Boolean)
  while (
    realParts.length > 0 &&
    logicalParts.length > 0 &&
    realParts[realParts.length - 1] === logicalParts[logicalParts.length - 1]
  ) {
    realParts.pop()
    logicalParts.pop()
  }
  const from = `/${realParts.join('/')}`
  const to = `/${logicalParts.join('/')}`
  if (from === to || from === '/') return path => normalizePath(path)

  return path => {
    const normal = normalizePath(path)
    if (!isInside(normal, from)) return normal

    return normalizePath(`${to}/${normal.slice(from.length)}`)
  }
}
