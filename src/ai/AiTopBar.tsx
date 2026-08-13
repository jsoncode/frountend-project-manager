import { SettingOutlined } from '@ant-design/icons'
import { Button, Select } from 'antd'
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
        <Select
          aria-label={t('ai.selectModel')}
          value={selectedModelId ?? undefined}
          disabled={activeModels.length === 0}
          placeholder={
            activeModels.length === 0 ? t('ai.noActiveModels') : undefined
          }
          options={activeModels.map((m) => ({
            value: m.id,
            label: m.remark.trim() || m.modelName,
          }))}
          onChange={(v) => setSelectedModelId(v ?? null)}
          style={{ flex: 1, minWidth: 180, maxWidth: 320 }}
        />
        <Tooltip title={t('ai.settings')} placement="bottom">
          <Button
            type="text"
            className="ai-topbar-settings"
            aria-label={t('ai.settings')}
            icon={<SettingOutlined style={{ fontSize: 18 }} />}
            onClick={() => setSettingsOpen(true)}
          />
        </Tooltip>
      </header>
      {settingsOpen ? (
        <AiModelSettingsModal onClose={() => setSettingsOpen(false)} />
      ) : null}
    </>
  )
}
