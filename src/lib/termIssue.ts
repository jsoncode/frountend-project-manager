/** Detect warning/error signals in terminal output and capture context for AI. */

export type TermIssueKind = 'error' | 'warning'

export type TermIssueAlert = {
  kind: TermIssueKind
  /** Plain-text log slice to feed AI */
  snippet: string
  detectedAt: number
}

const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\))/g

/** Strip CSI / OSC sequences so keyword matching sees real text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

/**
 * Match common build/runtime failure markers (EN + ZH).
 * Uses word boundaries for Latin tokens to cut false positives.
 */
const ERROR_RE =
  /(?:^|[^a-z0-9_])(?:error|errors|err!|failed|failure|exception|fatal|panic|traceback)(?:[^a-z0-9_]|$)|错误|失败|异常|报错/i

const WARNING_RE =
  /(?:^|[^a-z0-9_])(?:warning|warnings|warn)(?:[^a-z0-9_]|$)|警告/i

/** Ignore noisy “success / zero count” lines. */
const BENIGN_RE =
  /(?:\b0\s+errors?\b|\bno\s+errors?\b|\b0\s+warnings?\b|\bwithout\s+errors?\b|编译成功|构建成功)/i

export function detectIssueKind(rawChunk: string): TermIssueKind | null {
  const text = stripAnsi(rawChunk)
  if (!text.trim()) return null
  if (BENIGN_RE.test(text)) {
    const withoutBenign = text.replace(BENIGN_RE, ' ')
    if (!ERROR_RE.test(withoutBenign) && !WARNING_RE.test(withoutBenign)) {
      return null
    }
  }
  if (ERROR_RE.test(text)) return 'error'
  if (WARNING_RE.test(text)) return 'warning'
  return null
}

/** Prefer the last N non-empty lines as AI context. */
export function trimLogTail(text: string, maxLines = 100, maxChars = 24_000): string {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const tail = lines.slice(-maxLines).join('\n').trim()
  if (tail.length <= maxChars) return tail
  return `…[earlier output truncated]\n${tail.slice(-maxChars)}`
}
