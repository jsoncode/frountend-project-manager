import {
  CaretDownOutlined,
  CaretRightOutlined,
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  SendOutlined,
} from '@ant-design/icons'
import { Button, Input, Spin } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import type { MessageKey } from '../i18n/messages'
import {
  formatDuration,
  formatTokensPerSec,
} from '../lib/aiChat'
import type { AiMessage } from '../lib/aiTypes'
import { useAiStore } from '../stores/aiStore'

const KNOWN_ERROR_KEYS = new Set<string>([
  'ai.error.noModel',
  'ai.error.unsupportedModel',
  'ai.error.tauriOnly',
])

export function AiMessageList() {
  const { t } = useI18n()
  const messages = useAiStore((s) => s.messages)
  const generating = useAiStore((s) => s.generating)
  const streamingAssistantId = useAiStore((s) => s.streamingAssistantId)
  const error = useAiStore((s) => s.error)
  const deleteMessage = useAiStore((s) => s.deleteMessage)
  const updateMessageContent = useAiStore((s) => s.updateMessageContent)
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLElement>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>(
    {},
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Streaming: jump straight to the bottom (scrollTop assignment, not a per-chunk
  // smooth scrollIntoView — the smooth animation is the jank source in long
  // replies, audit P2-13). Idle: settle to the bottom without animation.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (generating) {
      el.scrollTop = el.scrollHeight
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' })
    }
  }, [messages, generating, error])

  // Clear the copy-confirmation timer on unmount.
  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    },
    [],
  )

  // Drop openReasoning entries for messages that no longer exist (the map
  // otherwise grows unboundedly across long sessions, audit P2-13).
  useEffect(() => {
    setOpenReasoning((prev) => {
      const ids = new Set(messages.map((m) => m.id))
      let changed = false
      const next: Record<string, boolean> = {}
      for (const [id, open] of Object.entries(prev)) {
        if (ids.has(id)) next[id] = open
        else changed = true
      }
      return changed ? next : prev
    })
  }, [messages])

  const errorText =
    error && KNOWN_ERROR_KEYS.has(error) ? t(error as MessageKey) : error

  const copyMessage = async (m: AiMessage) => {
    const text = m.content.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(m.id)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null
        setCopiedId((cur) => (cur === m.id ? null : cur))
      }, 1200)
    } catch {
      /* ignore */
    }
  }

  const startEdit = (m: AiMessage) => {
    if (generating) return
    setEditingId(m.id)
    setEditDraft(m.content)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDraft('')
  }

  const saveEdit = async () => {
    if (!editingId) return
    const id = editingId
    const content = editDraft
    setEditingId(null)
    await updateMessageContent(id, content)
  }

  if (messages.length === 0 && !error) {
    return (
      <main className="ai-messages ai-messages-center">
        <p className="ai-messages-empty">{t('ai.messagesEmpty')}</p>
      </main>
    )
  }

  return (
    <main ref={listRef} className="ai-messages">
      <div className="ai-message-list">
        {messages.map((m) => {
          if (m.role === 'system') return null
          const isUser = m.role === 'user'
          const hasReasoning = Boolean(m.reasoning?.trim())
          const reasoningOpen = openReasoning[m.id] ?? false
          const editing = editingId === m.id
          const isStreaming =
            generating && !isUser && m.id === streamingAssistantId
          const stats = m.stats

          return (
            <article
              key={m.id}
              className={`ai-message ${isUser ? 'ai-message-user' : 'ai-message-assistant'}`}
            >
              {hasReasoning ? (
                <div className="ai-message-reasoning">
                  <Button
                    type="text"
                    size="small"
                    className="ai-reasoning-toggle"
                    icon={
                      reasoningOpen ? (
                        <CaretDownOutlined style={{ fontSize: 12 }} />
                      ) : (
                        <CaretRightOutlined style={{ fontSize: 12 }} />
                      )
                    }
                    onClick={() =>
                      setOpenReasoning((prev) => ({
                        ...prev,
                        [m.id]: !reasoningOpen,
                      }))
                    }
                  >
                    {t('ai.reasoning')}
                  </Button>
                  {reasoningOpen ? (
                    <pre className="ai-reasoning-body">{m.reasoning}</pre>
                  ) : null}
                </div>
              ) : null}

              {editing ? (
                <Input.TextArea
                  className="ai-message-edit"
                  autoFocus
                  autoSize={{ minRows: 3, maxRows: 12 }}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelEdit()
                    }
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      void saveEdit()
                    }
                  }}
                />
              ) : (
                <div className="ai-message-content">
                  {m.content ||
                    (isStreaming ? (
                      <span className="ai-message-typing">
                        <Spin size="small" style={{ marginRight: 6 }} />
                        {t('ai.generating')}
                      </span>
                    ) : (
                      ''
                    ))}
                </div>
              )}

              {!isUser && stats ? (
                <div className="ai-message-stats" title={stats.debug}>
                  <span>
                    {t('ai.statsRate', {
                      rate: formatTokensPerSec(stats.tokensPerSec),
                    })}
                  </span>
                  <span className="ai-message-stats-sep">·</span>
                  <span>
                    {t('ai.statsTotal', { n: String(stats.outputTokens) })}
                  </span>
                  <span className="ai-message-stats-sep">·</span>
                  <span>
                    {t('ai.statsDuration', {
                      t: formatDuration(stats.durationMs),
                    })}
                  </span>
                  {stats.debug ? (
                    <>
                      <span className="ai-message-stats-sep">·</span>
                      <span className="ai-message-stats-debug">
                        {stats.debug}
                      </span>
                    </>
                  ) : null}
                </div>
              ) : null}

              <div className="ai-message-actions">
                {editing ? (
                  <>
                    <Button
                      type="text"
                      size="small"
                      title={t('ai.cancelEdit')}
                      aria-label={t('ai.cancelEdit')}
                      icon={<CloseOutlined />}
                      onClick={cancelEdit}
                    />
                    <Button
                      type="text"
                      size="small"
                      title={t('ai.saveEdit')}
                      aria-label={t('ai.saveEdit')}
                      icon={<SendOutlined />}
                      onClick={() => void saveEdit()}
                    />
                  </>
                ) : (
                  <>
                    <Button
                      type="text"
                      size="small"
                      title={
                        copiedId === m.id ? t('ai.copied') : t('ai.copy')
                      }
                      aria-label={t('ai.copy')}
                      disabled={!m.content.trim()}
                      icon={copiedId === m.id ? <CheckOutlined /> : <CopyOutlined />}
                      onClick={() => void copyMessage(m)}
                    />
                    {isUser ? (
                      <>
                        <Button
                          type="text"
                          size="small"
                          title={t('ai.editMessage')}
                          aria-label={t('ai.editMessage')}
                          disabled={generating}
                          icon={<EditOutlined />}
                          onClick={() => startEdit(m)}
                        />
                        <Button
                          type="text"
                          size="small"
                          danger
                          title={t('ai.deleteMessage')}
                          aria-label={t('ai.deleteMessage')}
                          disabled={generating}
                          icon={<DeleteOutlined />}
                          onClick={() => void deleteMessage(m.id)}
                        />
                      </>
                    ) : null}
                  </>
                )}
              </div>
            </article>
          )
        })}
        {errorText ? <div className="ai-error-bar">{errorText}</div> : null}
        <div ref={bottomRef} />
      </div>
    </main>
  )
}
