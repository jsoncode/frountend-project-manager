import { AddCircle, CheckSquare, CloseSquare, Pen, Trash } from 'reicon-react'
import { useState } from 'react'
import { ModalShell } from '../components/ModalShell'
import { useI18n } from '../i18n/useI18n'
import type { MessageKey } from '../i18n/messages'
import type { AiModel, AiModelType } from '../lib/aiTypes'
import { useAiStore } from '../stores/aiStore'
import {
  AiModelEditorModal,
  blankAiModel,
} from './AiModelEditorModal'

const TYPE_LABEL_KEYS: Record<AiModelType, MessageKey> = {
  text: 'ai.type.text',
  image: 'ai.type.image',
  audio: 'ai.type.audio',
  video: 'ai.type.video',
  multimodal: 'ai.type.multimodal',
}

type Props = {
  onClose: () => void
  inline?: boolean
}

type EditorState =
  | { mode: 'add' }
  | { mode: 'edit'; model: AiModel }
  | null

export function AiModelSettingsModal({ onClose, inline }: Props) {
  const { t } = useI18n()
  const config = useAiStore((s) => s.config)
  const saveConfig = useAiStore((s) => s.saveConfig)
  const [editor, setEditor] = useState<EditorState>(null)
  const [pendingDelete, setPendingDelete] = useState<AiModel | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const persistModels = async (models: AiModel[]) => {
    setBusy(true)
    setError(null)
    try {
      await saveConfig({
        ...config,
        models,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    } finally {
      setBusy(false)
    }
  }

  const saveFromEditor = async (model: AiModel) => {
    const exists = config.models.some((m) => m.id === model.id)
    const models = exists
      ? config.models.map((m) => (m.id === model.id ? model : m))
      : [...config.models, model]
    await persistModels(models)
  }

  const removeModel = async (model: AiModel) => {
    await persistModels(config.models.filter((m) => m.id !== model.id))
    setPendingDelete(null)
  }

  const toggleActive = async (model: AiModel) => {
    await persistModels(
      config.models.map((m) =>
        m.id === model.id ? { ...m, active: !m.active } : m,
      ),
    )
  }

  const content = (
    <>
      <div className="ai-settings-toolbar">
        <p className="muted" style={{ margin: 0, flex: 1 }}>
          {t('ai.settingsHint')}
        </p>
        <button
          type="button"
          className="ai-btn ai-btn-sm ai-icon-btn"
          disabled={busy}
          title={t('ai.addModel')}
          aria-label={t('ai.addModel')}
          onClick={() => setEditor({ mode: 'add' })}
        >
          <AddCircle className="ui-icon" size={20} color="currentColor" aria-hidden />
        </button>
      </div>

      {config.models.length === 0 ? (
        <p className="ai-settings-empty">{t('ai.noModels')}</p>
      ) : (
        <ul className="ai-model-list">
          {config.models.map((model) => {
            const title = model.remark.trim() || model.modelName || '—'
            return (
              <li key={model.id} className="ai-model-row">
                <div className="ai-model-row-main">
                  <span className="ai-model-row-title" title={title}>
                    {title}
                  </span>
                  <span className="ai-model-row-meta muted">
                    <span className="ai-model-type-pill">
                      {t(TYPE_LABEL_KEYS[model.type])}
                    </span>
                    {model.modelName.trim() ? (
                      <span>{model.modelName.trim()}</span>
                    ) : null}
                    {!model.active ? (
                      <span>{t('ai.modelInactive')}</span>
                    ) : null}
                  </span>
                </div>
                <div className="ai-model-row-actions">
                  <button
                    type="button"
                    className={`ai-btn ai-btn-sm ai-icon-btn${model.active ? ' is-active' : ''}`}
                    disabled={busy}
                    title={
                      model.active ? t('ai.modelActive') : t('ai.modelInactive')
                    }
                    aria-label={
                      model.active ? t('ai.modelActive') : t('ai.modelInactive')
                    }
                    aria-pressed={model.active}
                    onClick={() => void toggleActive(model)}
                  >
                    {model.active ? (
                      <CheckSquare
                        className="ui-icon"
                        size={18}
                        color="currentColor"
                        aria-hidden
                      />
                    ) : (
                      <CloseSquare
                        className="ui-icon"
                        size={18}
                        color="currentColor"
                        aria-hidden
                      />
                    )}
                  </button>
                  <button
                    type="button"
                    className="ai-btn ai-btn-sm ai-icon-btn"
                    disabled={busy}
                    title={t('ai.editModel')}
                    aria-label={t('ai.editModel')}
                    onClick={() => setEditor({ mode: 'edit', model })}
                  >
                    <Pen className="ui-icon" size={18} color="currentColor" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="ai-btn ai-btn-sm ai-btn-danger ai-icon-btn"
                    disabled={busy}
                    title={t('ai.deleteModel')}
                    aria-label={t('ai.deleteModel')}
                    onClick={() => setPendingDelete(model)}
                  >
                    <Trash className="ui-icon" size={18} color="currentColor" aria-hidden />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {error ? <p className="ai-settings-error">{error}</p> : null}
    </>
  )

  const modalFooter = (
    <div className="modal-actions">
      <button type="button" className="ai-btn" onClick={onClose}>
        {t('settings.close')}
      </button>
    </div>
  )

  if (inline) {
    return (
      <>
        <div className="settings-inline-panel">
          {content}
        </div>
        {editor ? (
          <AiModelEditorModal
            key={editor.mode === 'edit' ? editor.model.id : 'new'}
            initial={
              editor.mode === 'edit' ? { ...editor.model } : blankAiModel()
            }
            onClose={() => setEditor(null)}
            onSave={saveFromEditor}
          />
        ) : null}
        {pendingDelete ? (
          <ModalShell
            title={t('ai.deleteModelTitle')}
            onClose={() => setPendingDelete(null)}
            nested
            closeOnEsc={false}
            footer={
              <div className="modal-actions">
                <button
                  type="button"
                  className="ai-btn"
                  onClick={() => setPendingDelete(null)}
                >
                  {t('branch.cancel')}
                </button>
                <button
                  type="button"
                  className="ai-btn ai-btn-danger btn-with-icon"
                  disabled={busy}
                  onClick={() => void removeModel(pendingDelete)}
                >
                  <Trash className="ui-icon" size={14} color="currentColor" aria-hidden />
                  {t('ai.deleteModel')}
                </button>
              </div>
            }
          >
            <p className="muted">
              {t('ai.deleteModelConfirm', {
                title:
                  pendingDelete.remark.trim() ||
                  pendingDelete.modelName ||
                  '—',
              })}
            </p>
          </ModalShell>
        ) : null}
      </>
    )
  }

  return (
    <>      
      <ModalShell
        title={t('ai.settingsTitle')}
        onClose={onClose}
        elevated
        className="ai-settings-modal"
        footer={modalFooter}
      >
        {content}
      </ModalShell>

      {editor ? (
        <AiModelEditorModal
          key={editor.mode === 'edit' ? editor.model.id : 'new'}
          initial={
            editor.mode === 'edit' ? { ...editor.model } : blankAiModel()
          }
          onClose={() => setEditor(null)}
          onSave={saveFromEditor}
        />
      ) : null}

      {pendingDelete ? (
        <ModalShell
          title={t('ai.deleteModelTitle')}
          onClose={() => setPendingDelete(null)}
          nested
          closeOnEsc={false}
          footer={
            <div className="modal-actions">
              <button
                type="button"
                className="ai-btn"
                onClick={() => setPendingDelete(null)}
              >
                {t('branch.cancel')}
              </button>
              <button
                type="button"
                className="ai-btn ai-btn-danger btn-with-icon"
                disabled={busy}
                onClick={() => void removeModel(pendingDelete)}
              >
                <Trash className="ui-icon" size={14} color="currentColor" aria-hidden />
                {t('ai.deleteModel')}
              </button>
            </div>
          }
        >
          <p className="muted">
            {t('ai.deleteModelConfirm', {
              title:
                pendingDelete.remark.trim() ||
                pendingDelete.modelName ||
                '—',
            })}
          </p>
        </ModalShell>
      ) : null}
    </>
  )
}
