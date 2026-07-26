import type { AiAttachment, AiConversation } from './aiTypes'

export const ATTACHMENT_MAX_CHARS = 100_000
export const PROGRAMMING_SYSTEM_PROMPT =
  '你是资深工程师助手。优先给出可执行的代码与排查步骤，使用简体中文回复。'

export function truncateAttachment(text: string): string {
  if (text.length <= ATTACHMENT_MAX_CHARS) return text
  const marker = '…[truncated]'
  return `${text.slice(0, ATTACHMENT_MAX_CHARS - marker.length)}${marker}`
}

export function groupConversations(
  list: AiConversation[],
  nowMs = Date.now(),
): { recent: AiConversation[]; older: AiConversation[] } {
  const month = 30 * 86400000
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt)
  return {
    recent: sorted.filter((c) => nowMs - c.updatedAt <= month),
    older: sorted.filter((c) => nowMs - c.updatedAt > month),
  }
}

export function buildUserContent(
  userText: string,
  attachment?: AiAttachment | null,
): string {
  const q = userText.trim()
  if (!attachment?.text) return q
  const body = truncateAttachment(attachment.text)
  return `[终端选区]\n\`\`\`\n${body}\n\`\`\`\n\n---\n${q}`
}

export function defaultConversationTitle(seed?: string): string {
  const t = (seed ?? '').trim().replace(/\s+/g, ' ')
  if (!t) return '新对话'
  return t.length > 24 ? `${t.slice(0, 24)}…` : t
}

/** Rough token estimate: CJK ≈ 1 token/char, Latin ≈ 4 chars/token. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjk += 1
    } else if (/\s/.test(ch)) {
      // ignore whitespace weight
    } else {
      other += 1
    }
  }
  return Math.max(0, cjk + Math.ceil(other / 4))
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`
}

export function formatTokensPerSec(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  return n >= 100 ? n.toFixed(0) : n.toFixed(1)
}
