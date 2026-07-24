import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import type { MessageKey } from '../i18n/messages'
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
  const error = useAiStore((s) => s.error)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>({})

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: generating ? 'smooth' : 'auto' })
  }, [messages, generating, error])

  const errorText =
    error && KNOWN_ERROR_KEYS.has(error)
      ? t(error as MessageKey)
      : error

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
          return (
            <article
              key={m.id}
              className={`ai-message ${isUser ? 'ai-message-user' : 'ai-message-assistant'}`}
            >
              <div className="ai-message-role">
                {isUser ? t('ai.roleUser') : t('ai.roleAssistant')}
              </div>
              {hasReasoning ? (
                <div className="ai-message-reasoning">
                  <button
                    type="button"
                    className="ai-reasoning-toggle"
                    onClick={() =>
                      setOpenReasoning((prev) => ({
                        ...prev,
                        [m.id]: !reasoningOpen,
                      }))
                    }
                  >
                    {reasoningOpen ? '▾' : '▸'} {t('ai.reasoning')}
                  </button>
                  {reasoningOpen ? (
                    <pre className="ai-reasoning-body">{m.reasoning}</pre>
                  ) : null}
                </div>
              ) : null}
              <div className="ai-message-content">
                {m.content ||
                  (generating && !isUser ? (
                    <span className="ai-message-typing">{t('ai.generating')}</span>
                  ) : (
                    ''
                  ))}
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
