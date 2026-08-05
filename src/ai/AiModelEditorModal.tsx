import { Eye, EyeClosed, Save } from 'reicon-react'
import { useState } from 'react'
import { ModalShell } from '../components/ModalShell'
import { useI18n } from '../i18n/useI18n'
import type { MessageKey } from '../i18n/messages'
import type { AiModel, AiModelType } from '../lib/aiTypes'

const MODEL_TYPES: AiModelType[] = [
  'text',
  'image',
  'audio',
  'video',
  'multimodal',
]

const TYPE_LABEL_KEYS: Record<AiModelType, MessageKey> = {
  text: 'ai.type.text',
  image: 'ai.type.image',
  audio: 'ai.type.audio',
  video: 'ai.type.video',
  multimodal: 'ai.type.multimodal',
}

export function blankAiModel(): AiModel {
  return {
    id: '',
    remark: '',
    baseUrl: '',
    modelName: '',
    token: '',
    type: 'text',
    active: true,
  }
}

type Props = {
  initial: AiModel
  onClose: () => void
  onSave: (model: AiModel) => Promise<void>
}

export function AiModelEditorModal({ initial, onClose, onSave }: Props) {
  const { t } = useI18n()
  const isEdit = Boolean(initial.id)
  const [draft, setDraft] = useState<AiModel>(() => ({ ...initial }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showToken, setShowToken] = useState(false)

  const patch = (next: Partial<AiModel>) => {
    setDraft((prev) => ({ ...prev, ...next }))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave({
        ...draft,
        id: draft.id || crypto.randomUUID(),
        remark: draft.remark.trim(),
        baseUrl: draft.baseUrl.trim(),
        modelName: draft.modelName.trim(),
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title={isEdit ? t('ai.editModelTitle') : t('ai.addModelTitle')}
      onClose={onClose}
      nested
      className="ai-model-editor-modal"
      footer={
        <div className="modal-actions">
          <button type="button" className="ai-btn" onClick={onClose}>
            {t('settings.close')}
          </button>
          <button
            type="button"
            className="ai-btn ai-btn-primary btn-with-icon"
            disabled={saving}
            onClick={() => void save()}
          >
            <Save className="ui-icon" size={14} color="currentColor" aria-hidden />
            {t('ai.save')}
          </button>
        </div>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {t('ai.settingsHint')}
      </p>
      <div className="ai-model-editor-fields">
        <label className="ai-field">
          <span className="muted">{t('ai.modelRemark')}</span>
          <input
            value={draft.remark}
            onChange={(e) => patch({ remark: e.target.value })}
          />
        </label>
        <label className="ai-field">
          <span className="muted">{t('ai.modelBaseUrl')}</span>
          <input
            value={draft.baseUrl}
            placeholder="https://api.openai.com/v1"
            onChange={(e) => patch({ baseUrl: e.target.value })}
          />
        </label>
        <label className="ai-field">
          <span className="muted">{t('ai.modelName')}</span>
          <input
            value={draft.modelName}
            onChange={(e) => patch({ modelName: e.target.value })}
          />
        </label>
        <label className="ai-field">
          <span className="muted">{t('ai.modelToken')}</span>
          <div className="ai-field-secret">
            <input
              type={showToken ? 'text' : 'password'}
              autoComplete="off"
              value={draft.token}
              onChange={(e) => patch({ token: e.target.value })}
            />
            <button
              type="button"
              className="ai-field-secret-toggle"
              aria-label={
                showToken ? t('ai.hideToken') : t('ai.showToken')
              }
              title={showToken ? t('ai.hideToken') : t('ai.showToken')}
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken ? (
                <EyeClosed
                  className="ui-icon"
                  size={16}
                  color="currentColor"
                  aria-hidden
                />
              ) : (
                <Eye
                  className="ui-icon"
                  size={16}
                  color="currentColor"
                  aria-hidden
                />
              )}
            </button>
          </div>
        </label>
        <label className="ai-field">
          <span className="muted">{t('ai.modelType')}</span>
          <select
            className="ai-field-select"
            value={draft.type}
            onChange={(e) =>
              patch({ type: e.target.value as AiModelType })
            }
          >
            {MODEL_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(TYPE_LABEL_KEYS[type])}
              </option>
            ))}
          </select>
        </label>
        <label className="ai-enable">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => patch({ active: e.target.checked })}
          />
          {t('ai.modelActive')}
        </label>
      </div>
      {error ? <p className="ai-settings-error">{error}</p> : null}
    </ModalShell>
  )
}
