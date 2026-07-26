import { Paperclip, Send, Stop, X } from 'reicon-react'
import { useState, type KeyboardEvent } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useAiStore } from '../stores/aiStore'

export function AiComposer() {
  const { t } = useI18n()
  const [draft, setDraft] = useState('')

  const streamEnabled = useAiStore((s) => s.streamEnabled)
  const thinkEnabled = useAiStore((s) => s.thinkEnabled)
  const codeEnabled = useAiStore((s) => s.codeEnabled)
  const setStreamEnabled = useAiStore((s) => s.setStreamEnabled)
  const setThinkEnabled = useAiStore((s) => s.setThinkEnabled)
  const setCodeEnabled = useAiStore((s) => s.setCodeEnabled)
  const pendingAttachment = useAiStore((s) => s.pendingAttachment)
  const clearAttachment = useAiStore((s) => s.clearAttachment)
  const generating = useAiStore((s) => s.generating)
  const sendMessage = useAiStore((s) => s.sendMessage)
  const stopGeneration = useAiStore((s) => s.stopGeneration)
  const models = useAiStore((s) => s.config.models)
  const selectedModelId = useAiStore((s) => s.selectedModelId)

  const activeModels = models.filter((m) => m.active)
  const selected = models.find((m) => m.id === selectedModelId)
  const canSend =
    !generating &&
    draft.trim().length > 0 &&
    activeModels.length > 0 &&
    Boolean(selected) &&
    (selected?.type === 'text' || selected?.type === 'multimodal')

  const onSend = () => {
    if (!canSend) return
    const text = draft
    setDraft('')
    void sendMessage(text)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend()
    }
  }

  return (
    <footer className="ai-composer">
      {pendingAttachment ? (
        <div className="ai-attachment-chip">
          <Paperclip className="ui-icon" size={13} color="currentColor" aria-hidden />
          <span className="ai-attachment-label">{t('ai.attachment')}</span>
          <span className="ai-attachment-preview" title={pendingAttachment.text}>
            {pendingAttachment.text.slice(0, 80)}
            {pendingAttachment.text.length > 80 ? '…' : ''}
          </span>
          <button
            type="button"
            className="ai-btn ai-btn-sm"
            onClick={() => clearAttachment()}
            title={t('ai.removeAttachment')}
            aria-label={t('ai.removeAttachment')}
          >
            <X className="ui-icon" size={12} color="currentColor" aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="ai-composer-toggles">
        <label className="ai-toggle">
          <input
            type="checkbox"
            checked={streamEnabled}
            disabled={generating}
            onChange={(e) => setStreamEnabled(e.target.checked)}
          />
          <span>{t('ai.stream')}</span>
        </label>
        <label className="ai-toggle">
          <input
            type="checkbox"
            checked={thinkEnabled}
            disabled={generating}
            onChange={(e) => setThinkEnabled(e.target.checked)}
          />
          <span>{t('ai.think')}</span>
        </label>
        <label className="ai-toggle">
          <input
            type="checkbox"
            checked={codeEnabled}
            disabled={generating}
            onChange={(e) => setCodeEnabled(e.target.checked)}
          />
          <span>{t('ai.code')}</span>
        </label>
      </div>

      <div className="ai-composer-row">
        <textarea
          className="ai-composer-input"
          rows={2}
          value={draft}
          disabled={generating}
          placeholder={
            activeModels.length === 0
              ? t('ai.noActiveModels')
              : t('ai.composerPlaceholder')
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {generating ? (
          <button
            type="button"
            className="ai-btn ai-btn-danger btn-with-icon"
            onClick={() => void stopGeneration()}
          >
            <Stop className="ui-icon" size={14} color="currentColor" aria-hidden />
            {t('ai.stop')}
          </button>
        ) : (
          <button
            type="button"
            className="ai-btn ai-btn-primary btn-with-icon"
            disabled={!canSend}
            onClick={onSend}
          >
            <Send className="ui-icon" size={14} color="currentColor" aria-hidden />
            {t('ai.send')}
          </button>
        )}
      </div>
    </footer>
  )
}
