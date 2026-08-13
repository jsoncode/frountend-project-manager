import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { invoke } from '@tauri-apps/api/core'
import { useMemo, useState } from 'react'
import { ModalShell } from '../components/ModalShell'
import { useI18n } from '../i18n/useI18n'
import { groupConversations } from '../lib/aiChat'
import type { AiConversation, AiMessage } from '../lib/aiTypes'
import { isTauri } from '../lib/tauri'
import { useAiStore } from '../stores/aiStore'

export function AiSidebar() {
  const { t } = useI18n()
  const conversations = useAiStore((s) => s.conversations)
  const activeId = useAiStore((s) => s.activeConversationId)
  const messages = useAiStore((s) => s.messages)
  const createConversation = useAiStore((s) => s.createConversation)
  const selectConversation = useAiStore((s) => s.selectConversation)
  const deleteConversation = useAiStore((s) => s.deleteConversation)
  const generating = useAiStore((s) => s.generating)

  const [pendingDelete, setPendingDelete] = useState<AiConversation | null>(null)

  const { recent, older } = useMemo(
    () => groupConversations(conversations),
    [conversations],
  )

  const isEmptyConversation = async (id: string) => {
    if (id === activeId) {
      return messages.length === 0
    }
    if (!isTauri()) return true
    try {
      const list = await invoke<AiMessage[]>('ai_get_messages', {
        conversationId: id,
      })
      return list.length === 0
    } catch {
      return false
    }
  }

  const requestDelete = async (c: AiConversation) => {
    if (await isEmptyConversation(c.id)) {
      await deleteConversation(c.id)
      return
    }
    setPendingDelete(c)
  }

  const renderGroup = (title: string, list: AiConversation[]) => {
    if (list.length === 0) return null
    return (
      <section className="ai-sidebar-group">
        <h2 className="ai-sidebar-group-title">{title}</h2>
        <ul className="ai-sidebar-list">
          {list.map((c) => {
            const active = c.id === activeId
            return (
              <li key={c.id} className={`ai-sidebar-item${active ? ' active' : ''}`}>
                <button
                  type="button"
                  className="ai-sidebar-item-btn"
                  disabled={generating}
                  onClick={() => void selectConversation(c.id)}
                  title={c.title}
                >
                  <span className="ai-sidebar-item-title">{c.title}</span>
                </button>
                <Button
                  type="text"
                  size="small"
                  className="ai-sidebar-item-delete"
                  title={t('ai.delete')}
                  aria-label={t('ai.delete')}
                  disabled={generating}
                  icon={<DeleteOutlined />}
                  onClick={(e) => {
                    e.stopPropagation()
                    void requestDelete(c)
                  }}
                />
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  return (
    <aside className="ai-sidebar">
      <div className="ai-sidebar-header">
        <span className="ai-sidebar-title">{t('ai.title')}</span>
        <Button
          type="text"
          className="ai-sidebar-new"
          disabled={generating}
          title={t('ai.newChat')}
          aria-label={t('ai.newChat')}
          icon={<PlusOutlined style={{ fontSize: 18 }} />}
          onClick={() => void createConversation()}
        />
      </div>
      <div className="ai-sidebar-groups">
        {conversations.length === 0 ? (
          <p className="ai-sidebar-placeholder">{t('ai.historyEmpty')}</p>
        ) : (
          <>
            {renderGroup(t('ai.recentMonth'), recent)}
            {renderGroup(t('ai.older'), older)}
          </>
        )}
      </div>

      {pendingDelete ? (
        <ModalShell
          title={t('ai.deleteTitle')}
          onClose={() => setPendingDelete(null)}
          closeOnEsc={false}
          footer={
            <>
              <Button onClick={() => setPendingDelete(null)}>
                {t('branch.cancel')}
              </Button>
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() => {
                  const id = pendingDelete.id
                  setPendingDelete(null)
                  void deleteConversation(id)
                }}
              >
                {t('ai.delete')}
              </Button>
            </>
          }
        >
          <p className="muted">
            {t('ai.deleteConfirm', { title: pendingDelete.title })}
          </p>
        </ModalShell>
      ) : null}
    </aside>
  )
}
