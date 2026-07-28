/** One conflict hunk between <<<<<<< / ======= / >>>>>>> markers. */
export type ConflictHunk = {
  start: number
  mid: number
  end: number
  ours: string
  theirs: string
  /** Full text of the hunk including markers (for replacement). */
  full: string
}

const MID_RE = /^=======\r?\n/

/**
 * Parse git conflict markers in a working-tree file.
 * Indices are character offsets into `text` (normalized LF preferred).
 */
export function parseConflictHunks(text: string): ConflictHunk[] {
  const hunks: ConflictHunk[] = []
  let i = 0
  while (i < text.length) {
    const start = text.indexOf('<<<<<<<', i)
    if (start < 0) break
    // Ensure start of line
    if (start > 0 && text[start - 1] !== '\n') {
      i = start + 7
      continue
    }
    const afterStartLine = text.indexOf('\n', start)
    if (afterStartLine < 0) break
    const oursBegin = afterStartLine + 1

    let mid = -1
    let scan = oursBegin
    while (scan < text.length) {
      const lineStart = scan
      const nl = text.indexOf('\n', scan)
      const lineEnd = nl < 0 ? text.length : nl + 1
      const line = text.slice(lineStart, lineEnd)
      if (MID_RE.test(line) || line === '=======\n' || line === '=======\r\n' || line.trimEnd() === '=======') {
        mid = lineStart
        break
      }
      if (line.startsWith('<<<<<<<')) break
      scan = lineEnd
      if (nl < 0) break
    }
    if (mid < 0) {
      i = oursBegin
      continue
    }

    const midNl = text.indexOf('\n', mid)
    const theirsBegin = midNl < 0 ? text.length : midNl + 1

    let end = -1
    let endLineEnd = -1
    scan = theirsBegin
    while (scan < text.length) {
      const lineStart = scan
      const nl = text.indexOf('\n', scan)
      const lineEnd = nl < 0 ? text.length : nl + 1
      const line = text.slice(lineStart, lineEnd)
      if (line.startsWith('>>>>>>>')) {
        end = lineStart
        endLineEnd = lineEnd
        break
      }
      if (line.startsWith('<<<<<<<')) break
      scan = lineEnd
      if (nl < 0) break
    }
    if (end < 0) {
      i = theirsBegin
      continue
    }

    const ours = text.slice(oursBegin, mid)
    const theirs = text.slice(theirsBegin, end)
    const full = text.slice(start, endLineEnd)
    hunks.push({ start, mid, end, ours, theirs, full })
    i = endLineEnd
  }
  return hunks
}

export function applyHunkChoice(
  text: string,
  hunk: ConflictHunk,
  choice: 'ours' | 'theirs' | 'both',
): string {
  const replacement =
    choice === 'ours'
      ? hunk.ours
      : choice === 'theirs'
        ? hunk.theirs
        : `${hunk.ours}${hunk.theirs}`
  return text.slice(0, hunk.start) + replacement + text.slice(hunk.start + hunk.full.length)
}

/** Apply choice to the Nth remaining hunk (0-based) after re-parse. */
export function applyNthHunkChoice(
  text: string,
  index: number,
  choice: 'ours' | 'theirs' | 'both',
): string {
  const hunks = parseConflictHunks(text)
  const hunk = hunks[index]
  if (!hunk) return text
  return applyHunkChoice(text, hunk, choice)
}

export function looksBinary(text: string): boolean {
  return text.includes('\0')
}
