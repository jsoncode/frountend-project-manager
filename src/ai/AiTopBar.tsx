import { Settings } from 'reicon-react'
import { useState } from 'react'
import { Tooltip } from '../components/Tooltip'
import { useI18n } from '../i18n/useI18n'
import { useAiStore } from '../stores/aiStore'
import { AiModelSettingsModal } from './AiModelSettingsModal'

export function AiTopBar() {
  const { t } = useI18n()
  const selectedModelId = useAiStore((s) => s.selectedModelId)
  const setSelectedModelId = useAiStore((s) => s.setSelectedModelId)
  const models = useAiStore((s) => s.config.models)
  const activeModels = models.filter((m) => m.active)
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <>
      <header className="ai-topbar">
        <select
          className="ai-model-select"
          aria-label={t('ai.selectModel')}
          value={selectedModelId ?? ''}
          disabled={activeModels.length === 0}
          onChange={(e) => {
            const v = e.target.value
            setSelectedModelId(v || null)
          }}
        >
          {activeModels.length === 0 ? (
            <option value="">{t('ai.noActiveModels')}</option>
          ) : (
            activeModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.remark.trim() || m.modelName}
              </option>
            ))
          )}
        </select>
        <Tooltip title={t('ai.settings')} placement="bottom">
          <button
            type="button"
            className="ai-btn ai-btn-sm ai-topbar-settings"
            aria-label={t('ai.settings')}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="ui-icon" size={20} color="currentColor" aria-hidden />
          </button>
        </Tooltip>
      </header>
      {settingsOpen ? (
        <AiModelSettingsModal onClose={() => setSettingsOpen(false)} />
      ) : null}
    </>
  )
}
