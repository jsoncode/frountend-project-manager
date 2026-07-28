/** Match absolute Windows / POSIX paths in terminal output. */

/**
 * File path with extension — allows spaces in names
 * (e.g. `D:\xxx\xx xx.text at …`).
 */
const WIN_FILE =
  /[A-Za-z]:(?:[\\/][^\\/<>:"|?*\r\n]+)+?\.[A-Za-z0-9]{1,20}(?::\d+){0,2}/g

/**
 * Drive path without requiring an extension (dirs / bare paths).
 * Segments forbid whitespace so we don't swallow trailing words
 * (e.g. `D:\cxa-back\frountend-project-manager > tsc`).
 */
const WIN_PATH =
  /[A-Za-z]:(?:[\\/][^\\/<>:"|?*\s\r\n]+)+/g

const POSIX_FILE =
  /(?:^|[\s("'`])(\/(?:[^/\s<>"|*?]+\/)*[^/\s<>"|*?]+\.[A-Za-z0-9]{1,20})(?::\d+){0,2}/g

const POSIX_PATH =
  /(?:^|[\s("'`])(\/(?:[^/\s<>"|*?]+\/)+[^/\s<>"|*?]+)/g

const TRAILING_JUNK = /[.,;:!?)\]}'"`]+$/
/** Strip editor-style `:12` / `:12:34` suffixes. */
const LINE_COL_SUFFIX = /(?::\d+){1,2}$/

export type FilePathMatch = {
  /** Raw matched span in the line (before cleanup). */
  raw: string
  /** Cleaned absolute path suitable for open/copy/reveal. */
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

function pushMatch(
  out: FilePathMatch[],
  seen: Set<string>,
  raw: string,
  start: number,
  end: number,
) {
  const path = cleanTerminalFilePath(raw)
  if (path.length < 4) return
  // Need at least `D:\a` or `/a/b`
  if (!/^[A-Za-z]:[/\\]/.test(path) && !path.startsWith('/')) return
  const key = `${start}:${end}:${path}`
  if (seen.has(key)) return
  seen.add(key)
  out.push({ raw, path, start, end })
}

function collectRegex(
  line: string,
  re: RegExp,
  out: FilePathMatch[],
  seen: Set<string>,
  group = 0,
) {
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    const raw = group > 0 ? (m[group] ?? m[0]) : m[0]
    const start =
      group > 0 && m[group]
        ? m.index + (m[0].length - m[group].length)
        : m.index
    pushMatch(out, seen, raw, start, start + raw.length)
  }
}

/** Prefer non-overlapping matches; on overlap keep the longer span. */
export function mergePathMatches(matches: FilePathMatch[]): FilePathMatch[] {
  const sorted = [...matches].sort(
    (a, b) => a.start - b.start || b.end - a.end - (a.end - a.start),
  )
  const out: FilePathMatch[] = []
  for (const m of sorted) {
    const last = out[out.length - 1]
    if (last && m.start < last.end) {
      if (m.end - m.start > last.end - last.start) {
        out[out.length - 1] = m
      }
      continue
    }
    out.push(m)
  }
  return out
}

/**
 * Find file/dir path spans in a terminal buffer line.
 * Indices refer to the original `line` string (0-based, end exclusive).
 */
export function findFilePathsInLine(line: string): FilePathMatch[] {
  const raw: FilePathMatch[] = []
  const seen = new Set<string>()

  collectRegex(line, WIN_FILE, raw, seen)
  collectRegex(line, WIN_PATH, raw, seen)
  collectRegex(line, POSIX_FILE, raw, seen, 1)
  collectRegex(line, POSIX_PATH, raw, seen, 1)

  return mergePathMatches(raw)
}
