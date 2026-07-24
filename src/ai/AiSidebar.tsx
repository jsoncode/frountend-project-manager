import { useMemo, useState } from 'react'
import { ModalShell } from '../components/ModalShell'
import { useI18n } from '../i18n/useI18n'
import { groupConversations } from '../lib/aiChat'
import type { AiConversation } from '../lib/aiTypes'
import { useAiStore } from '../stores/aiStore'

export function AiSidebar() {
  const { t } = useI18n()
  const conversations = useAiStore((s) => s.conversations)
  const activeId = useAiStore((s) => s.activeConversationId)
  const createConversation = useAiStore((s) => s.createConversation)
  const selectConversation = useAiStore((s) => s.selectConversation)
  const renameConversation = useAiStore((s) => s.renameConversation)
  const deleteConversation = useAiStore((s) => s.deleteConversation)
  const generating = useAiStore((s) => s.generating)

  const [pendingDelete, setPendingDelete] = useState<AiConversation | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const { recent, older } = useMemo(
    () => groupConversations(conversations),
    [conversations],
  )

  const startRename = (c: AiConversation) => {
    setRenamingId(c.id)
    setRenameValue(c.title)
  }

  const commitRename = async () => {
    if (!renamingId) return
    const id = renamingId
    const value = renameValue
    setRenamingId(null)
    await renameConversation(id, value)
  }

  const renderGroup = (title: string, list: AiConversation[]) => (
    <section className="ai-sidebar-group">
      <h2 className="ai-sidebar-group-title">{title}</h2>
      {list.length === 0 ? (
        <p className="ai-sidebar-placeholder">{t('ai.empty')}</p>
      ) : (
        <ul className="ai-sidebar-list">
          {list.map((c) => {
            const active = c.id === activeId
            const renaming = renamingId === c.id
            return (
              <li key={c.id} className={`ai-sidebar-item${active ? ' active' : ''}`}>
                {renaming ? (
                  <input
                    className="ai-sidebar-rename"
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void commitRename()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void commitRename()
                      }
                      if (e.key === 'Escape') {
                        setRenamingId(null)
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="ai-sidebar-item-btn"
                    disabled={generating}
                    onClick={() => void selectConversation(c.id)}
                    onDoubleClick={() => startRename(c)}
                    title={c.title}
                  >
                    <span className="ai-sidebar-item-title">{c.title}</span>
                  </button>
                )}
                <div className="ai-sidebar-item-actions">
                  <button
                    type="button"
                    className="ai-btn ai-btn-sm"
                    title={t('ai.rename')}
                    disabled={generating || renaming}
                    onClick={() => startRename(c)}
                  >
                    {t('ai.rename')}
                  </button>
                  <button
                    type="button"
                    className="ai-btn ai-btn-sm ai-btn-danger"
                    title={t('ai.delete')}
                    disabled={generating}
                    onClick={() => setPendingDelete(c)}
                  >
                    {t('ai.delete')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )

  return (
    <aside className="ai-sidebar">
      <div className="ai-sidebar-header">
        <span className="ai-sidebar-title">{t('ai.title')}</span>
        <button
          type="button"
          className="ai-btn ai-btn-sm"
          disabled={generating}
          onClick={() => void createConversation()}
        >
          {t('ai.newChat')}
        </button>
      </div>
      <div className="ai-sidebar-groups">
        {renderGroup(t('ai.recentMonth'), recent)}
        {renderGroup(t('ai.older'), older)}
      </div>

      {pendingDelete ? (
        <ModalShell
          title={t('ai.deleteTitle')}
          onClose={() => setPendingDelete(null)}
        >
          <p className="muted">
            {t('ai.deleteConfirm', { title: pendingDelete.title })}
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setPendingDelete(null)}
            >
              {t('branch.cancel')}
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                const id = pendingDelete.id
                setPendingDelete(null)
                void deleteConversation(id)
              }}
            >
              {t('ai.delete')}
            </button>
          </div>
        </ModalShell>
      ) : null}
    </aside>
  )
}
