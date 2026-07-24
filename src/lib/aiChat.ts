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
