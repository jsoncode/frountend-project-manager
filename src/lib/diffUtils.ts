/**
 * Line-based diff utilities using LCS (Longest Common Subsequence) algorithm.
 * Used for 3-pane merge editor to compute diffs between base/ours/theirs.
 */

export type DiffLineType = 'equal' | 'insert' | 'delete'

export type DiffLine = {
  type: DiffLineType
  content: string
  /** Line number in original file (1-based) */
  lineNo: number
  /** Line number in modified file (1-based, only for equal/insert) */
  modifiedLineNo?: number
}

export type DiffHunk = {
  start: number
  end: number
  lines: DiffLine[]
}

/**
 * Compute LCS-based diff between two arrays of lines.
 * Returns array of DiffLine with type annotations.
 */
export function computeLineDiff(
  originalLines: string[],
  modifiedLines: string[],
): DiffLine[] {
  const m = originalLines.length
  const n = modifiedLines.length

  // DP table for LCS length
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0))

  // Fill DP table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (originalLines[i - 1] === modifiedLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to find LCS
  const result: DiffLine[] = []
  let i = m
  let j = n
  const stack: DiffLine[] = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && originalLines[i - 1] === modifiedLines[j - 1]) {
      stack.push({
        type: 'equal',
        content: originalLines[i - 1],
        lineNo: i,
        modifiedLineNo: j,
      })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({
        type: 'insert',
        content: modifiedLines[j - 1],
        lineNo: 0,
        modifiedLineNo: j,
      })
      j--
    } else if (i > 0) {
      stack.push({
        type: 'delete',
        content: originalLines[i - 1],
        lineNo: i,
      })
      i--
    }
  }

  // Reverse to get correct order
  while (stack.length > 0) {
    result.push(stack.pop()!)
  }

  return result
}

/**
 * Group diff lines into hunks (contiguous changed regions).
 * Each hunk contains context lines before/after changes.
 */
export function groupIntoHunks(
  diffLines: DiffLine[],
  contextSize: number = 3,
): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let currentHunk: DiffHunk | null = null

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i]

    if (line.type !== 'equal') {
      // Start new hunk if needed
      if (!currentHunk) {
        // Add context lines before change
        const contextStart = Math.max(0, i - contextSize)
        currentHunk = {
          start: contextStart,
          end: i,
          lines: diffLines.slice(contextStart, i),
        }
      }

      // Add changed line
      currentHunk.lines.push(line)
      currentHunk.end = i + 1
    } else if (currentHunk) {
      // We're in a hunk and hit an equal line
      // Check if we should add context or close hunk
      const nextChange = diffLines.findIndex(
        (l, idx) => idx > i && l.type !== 'equal',
      )

      if (nextChange > 0 && nextChange - i <= contextSize * 2) {
        // Close enough to next change - include in same hunk
        currentHunk.lines.push(line)
        currentHunk.end = i + 1
      } else {
        // Add trailing context and close hunk
        const contextEnd = Math.min(diffLines.length, i + contextSize + 1)
        for (let j = i; j < contextEnd; j++) {
          currentHunk.lines.push(diffLines[j])
        }
        currentHunk.end = contextEnd
        hunks.push(currentHunk)
        currentHunk = null
      }
    }
  }

  // Close any remaining hunk
  if (currentHunk) {
    hunks.push(currentHunk)
  }

  return hunks
}

/**
 * Split text into lines, preserving line endings for accurate reconstruction.
 */
export function splitLines(text: string): string[] {
  if (!text) return []
  const lines: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lines.push(text.slice(start, i + 1))
      start = i + 1
    }
  }
  // Last line (may not have newline)
  if (start < text.length) {
    lines.push(text.slice(start))
  }
  return lines
}

/**
 * Compute hunks between two texts.
 */
export function computeHunks(original: string, modified: string): DiffHunk[] {
  const origLines = splitLines(original)
  const modLines = splitLines(modified)
  const diff = computeLineDiff(origLines, modLines)
  return groupIntoHunks(diff, 3)
}
