import { SaveOutlined } from '@ant-design/icons'
import { Button, Input, Select, Switch } from 'antd'
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
        <>
          <Button onClick={onClose}>{t('settings.close')}</Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            disabled={saving}
            onClick={() => void save()}
          >
            {t('ai.save')}
          </Button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {t('ai.settingsHint')}
      </p>
      <div className="ai-model-editor-fields">
        <label className="ai-field">
          <span className="muted">{t('ai.modelRemark')}</span>
          <Input
            value={draft.remark}
            onChange={(e) => patch({ remark: e.target.value })}
          />
        </label>
        <label className="ai-field">
          <span className="muted">{t('ai.modelBaseUrl')}</span>
          <Input
            value={draft.baseUrl}
            placeholder="https://api.openai.com/v1"
            onChange={(e) => patch({ baseUrl: e.target.value })}
          />
        </label>
        <label className="ai-field">
          <span className="muted">{t('ai.modelName')}</span>
          <Input
            value={draft.modelName}
            onChange={(e) => patch({ modelName: e.target.value })}
          />
        </label>
        <label className="ai-field">
          <span className="muted">{t('ai.modelToken')}</span>
          <Input.Password
            autoComplete="off"
            value={draft.token}
            onChange={(e) => patch({ token: e.target.value })}
          />
        </label>
        <label className="ai-field">
          <span className="muted">{t('ai.modelType')}</span>
          <Select
            value={draft.type}
            options={MODEL_TYPES.map((type) => ({
              value: type,
              label: t(TYPE_LABEL_KEYS[type]),
            }))}
            onChange={(v) => patch({ type: v as AiModelType })}
          />
        </label>
        <label className="ai-enable">
          <Switch
            checked={draft.active}
            onChange={(checked) => patch({ active: checked })}
          />
          {t('ai.modelActive')}
        </label>
      </div>
      {error ? <p className="ai-settings-error">{error}</p> : null}
    </ModalShell>
  )
}
