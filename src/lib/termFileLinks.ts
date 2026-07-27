/** Match absolute Windows / POSIX file paths in terminal output. */
// Prefer paths that end with an extension so spaces inside names still work
// (e.g. `D:\xxx\xx xx.text at …`).
const WIN_ABS =
  /[A-Za-z]:(?:[\\/][^\\/<>:"|?*\r\n]+)+?\.[A-Za-z0-9]{1,20}(?::\d+){0,2}/g
const POSIX_ABS =
  /(?:^|[\s("'`])(\/(?:[^/\s<>"|*?]+\/)*[^/\s<>"|*?]+\.[A-Za-z0-9]{1,20})(?::\d+){0,2}/g

const TRAILING_JUNK = /[.,;:!?)\]}'"`]+$/
/** Strip editor-style `:12` / `:12:34` suffixes. */
const LINE_COL_SUFFIX = /(?::\d+){1,2}$/

export type FilePathMatch = {
  /** Raw matched span in the line (before cleanup). */
  raw: string
  /** Cleaned absolute / relative path suitable for open/copy. */
  path: string
  /** 0-based start index in the line string. */
  start: number
  /** 0-based exclusive end index in the line string. */
  end: number
}

export function cleanTerminalFilePath(raw: string): string {
  let p = raw.trim()
  if (
    (p.startsWith('"') && p.endsWith('"')) ||
    (p.startsWith("'") && p.endsWith("'"))
  ) {
    p = p.slice(1, -1)
  }
  p = p.replace(TRAILING_JUNK, '')
  p = p.replace(LINE_COL_SUFFIX, '')
  if (/^[A-Za-z]:/.test(p)) {
    return p.replace(/\//g, '\\')
  }
  return p
}

/**
 * Find file-path-like spans in a terminal buffer line.
 * Indices refer to the original `line` string (0-based, end exclusive).
 */
export function findFilePathsInLine(line: string): FilePathMatch[] {
  const out: FilePathMatch[] = []
  const seen = new Set<string>()

  const push = (raw: string, start: number, end: number) => {
    const path = cleanTerminalFilePath(raw)
    if (path.length < 4) return
    const key = `${start}:${end}:${path}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ raw, path, start, end })
  }

  WIN_ABS.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIN_ABS.exec(line)) !== null) {
    push(m[0], m.index, m.index + m[0].length)
  }

  POSIX_ABS.lastIndex = 0
  while ((m = POSIX_ABS.exec(line)) !== null) {
    const raw = m[1] ?? m[0]
    const start = m[1] ? m.index + (m[0].length - m[1].length) : m.index
    push(raw, start, start + raw.length)
  }

  out.sort((a, b) => a.start - b.start)
  return out
}
