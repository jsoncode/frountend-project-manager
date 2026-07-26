import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Pen,
  Send,
  Trash,
  X,
} from 'reicon-react'
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
  const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>(
    {},
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: generating ? 'smooth' : 'auto',
    })
  }, [messages, generating, error])

  const errorText =
    error && KNOWN_ERROR_KEYS.has(error) ? t(error as MessageKey) : error

  const copyMessage = async (m: AiMessage) => {
    const text = m.content.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(m.id)
      window.setTimeout(() => {
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
    <main className="ai-messages">
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
                  <button
                    type="button"
                    className="ai-reasoning-toggle btn-with-icon"
                    onClick={() =>
                      setOpenReasoning((prev) => ({
                        ...prev,
                        [m.id]: !reasoningOpen,
                      }))
                    }
                  >
                    {reasoningOpen ? (
                      <ChevronDown
                        className="ui-icon"
                        size={12}
                        color="currentColor"
                        aria-hidden
                      />
                    ) : (
                      <ChevronRight
                        className="ui-icon"
                        size={12}
                        color="currentColor"
                        aria-hidden
                      />
                    )}
                    {t('ai.reasoning')}
                  </button>
                  {reasoningOpen ? (
                    <pre className="ai-reasoning-body">{m.reasoning}</pre>
                  ) : null}
                </div>
              ) : null}

              {editing ? (
                <textarea
                  className="ai-message-edit"
                  value={editDraft}
                  rows={Math.min(12, Math.max(3, editDraft.split('\n').length))}
                  autoFocus
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
                    <button
                      type="button"
                      className="ai-message-action"
                      title={t('ai.cancelEdit')}
                      aria-label={t('ai.cancelEdit')}
                      onClick={cancelEdit}
                    >
                      <X
                        className="ui-icon"
                        size={14}
                        color="currentColor"
                        aria-hidden
                      />
                    </button>
                    <button
                      type="button"
                      className="ai-message-action"
                      title={t('ai.saveEdit')}
                      aria-label={t('ai.saveEdit')}
                      onClick={() => void saveEdit()}
                    >
                      <Send
                        className="ui-icon"
                        size={14}
                        color="currentColor"
                        aria-hidden
                      />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="ai-message-action"
                      title={
                        copiedId === m.id ? t('ai.copied') : t('ai.copy')
                      }
                      aria-label={t('ai.copy')}
                      disabled={!m.content.trim()}
                      onClick={() => void copyMessage(m)}
                    >
                      {copiedId === m.id ? (
                        <Check
                          className="ui-icon"
                          size={14}
                          color="currentColor"
                          aria-hidden
                        />
                      ) : (
                        <Copy
                          className="ui-icon"
                          size={14}
                          color="currentColor"
                          aria-hidden
                        />
                      )}
                    </button>
                    {isUser ? (
                      <>
                        <button
                          type="button"
                          className="ai-message-action"
                          title={t('ai.editMessage')}
                          aria-label={t('ai.editMessage')}
                          disabled={generating}
                          onClick={() => startEdit(m)}
                        >
                          <Pen
                            className="ui-icon"
                            size={14}
                            color="currentColor"
                            aria-hidden
                          />
                        </button>
                        <button
                          type="button"
                          className="ai-message-action danger"
                          title={t('ai.deleteMessage')}
                          aria-label={t('ai.deleteMessage')}
                          disabled={generating}
                          onClick={() => void deleteMessage(m.id)}
                        >
                          <Trash
                            className="ui-icon"
                            size={14}
                            color="currentColor"
                            aria-hidden
                          />
                        </button>
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
