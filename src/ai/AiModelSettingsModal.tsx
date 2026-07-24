import { useState } from 'react'
import { ModalShell } from '../components/ModalShell'
import { useI18n } from '../i18n/useI18n'
import type { MessageKey } from '../i18n/messages'
import type { AiModel, AiModelType } from '../lib/aiTypes'
import { useAiStore } from '../stores/aiStore'

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

function blankModel(): AiModel {
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
  onClose: () => void
}

export function AiModelSettingsModal({ onClose }: Props) {
  const { t } = useI18n()
  const config = useAiStore((s) => s.config)
  const saveConfig = useAiStore((s) => s.saveConfig)
  const [draft, setDraft] = useState<AiModel[]>(() =>
    config.models.map((m) => ({ ...m })),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (index: number, patch: Partial<AiModel>) => {
    setDraft((prev) =>
      prev.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    )
  }

  const addModel = () => {
    setDraft((prev) => [...prev, blankModel()])
  }

  const removeModel = (index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const models = draft.map((m) => ({
        ...m,
        id: m.id || crypto.randomUUID(),
        remark: m.remark.trim(),
        baseUrl: m.baseUrl.trim(),
        modelName: m.modelName.trim(),
      }))
      await saveConfig({
        models,
        lastModelId: config.lastModelId,
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
      title={t('ai.settingsTitle')}
      onClose={onClose}
      wide
      className="ai-settings-modal"
    >
      <p className="muted">{t('ai.settingsHint')}</p>
      {draft.length === 0 ? (
        <p className="ai-settings-empty">{t('ai.noModels')}</p>
      ) : (
        <div className="ai-model-list">
          {draft.map((model, index) => (
            <div
              key={model.id || `new-${index}`}
              className="ai-model-card"
            >
              <div className="ai-model-card-top">
                <label className="ai-field" style={{ flex: 1 }}>
                  <span className="muted">{t('ai.modelRemark')}</span>
                  <input
                    value={model.remark}
                    onChange={(e) => update(index, { remark: e.target.value })}
                  />
                </label>
                <div className="ai-model-card-actions">
                  <label className="ai-enable">
                    <input
                      type="checkbox"
                      checked={model.active}
                      onChange={(e) =>
                        update(index, { active: e.target.checked })
                      }
                    />
                    {t('ai.modelActive')}
                  </label>
                  <button
                    type="button"
                    className="ai-btn ai-btn-sm ai-btn-danger"
                    onClick={() => removeModel(index)}
                  >
                    {t('ai.deleteModel')}
                  </button>
                </div>
              </div>
              <label className="ai-field">
                <span className="muted">{t('ai.modelBaseUrl')}</span>
                <input
                  value={model.baseUrl}
                  placeholder="https://api.openai.com/v1"
                  onChange={(e) => update(index, { baseUrl: e.target.value })}
                />
              </label>
              <label className="ai-field">
                <span className="muted">{t('ai.modelName')}</span>
                <input
                  value={model.modelName}
                  onChange={(e) =>
                    update(index, { modelName: e.target.value })
                  }
                />
              </label>
              <label className="ai-field">
                <span className="muted">{t('ai.modelToken')}</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={model.token}
                  onChange={(e) => update(index, { token: e.target.value })}
                />
              </label>
              <label className="ai-field">
                <span className="muted">{t('ai.modelType')}</span>
                <select
                  className="ai-field-select"
                  value={model.type}
                  onChange={(e) =>
                    update(index, { type: e.target.value as AiModelType })
                  }
                >
                  {MODEL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(TYPE_LABEL_KEYS[type])}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>
      )}
      {error ? <p className="ai-settings-error">{error}</p> : null}
      <div className="modal-actions">
        <button type="button" className="ai-btn" onClick={addModel}>
          {t('ai.addModel')}
        </button>
        <button
          type="button"
          className="ai-btn ai-btn-primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {t('ai.save')}
        </button>
        <button type="button" className="ai-btn" onClick={onClose}>
          {t('settings.close')}
        </button>
      </div>
    </ModalShell>
  )
}
