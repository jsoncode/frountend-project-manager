import { invoke } from '@tauri-apps/api/core'
import { useCallback, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useSettingsStore } from '../stores/settingsStore'
import { ContextMenuPortal } from './ContextMenuPortal'
import { IdeIcon } from './IdeIcon'

type Props = {
  path: string
  x: number
  y: number
  onClose: () => void
}

export function OpenWithMenu({ path, x, y, onClose }: Props) {
  const config = useSettingsStore((s) => s.config)
  const [error, setError] = useState<string | null>(null)
  const { t } = useI18n()
  const ides = (config?.ides ?? []).filter((i) => i.enabled)

  const close = useCallback(() => onClose(), [onClose])

  const openIde = async (ideId: string) => {
    setError(null)
    try {
      await invoke('open_in_ide', { ideId, projectPath: path })
      onClose()
    } catch (e) {
      setError(String(e))
    }
  }

  const reveal = async () => {
    setError(null)
    try {
      await invoke('reveal_in_file_manager', { path })
      onClose()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <ContextMenuPortal x={x} y={y} onClose={close}>
      {ides.map((ide) => (
        <button
          key={ide.id}
          type="button"
          role="menuitem"
          className="open-with-ide"
          onClick={() => void openIde(ide.id)}
        >
          <IdeIcon iconPath={ide.iconPath} name={ide.name} size={16} />
          <span>{t('open.withIde', { name: ide.name })}</span>
        </button>
      ))}
      {ides.length === 0 && (
        <div className="branch-menu-hint muted">{t('open.noIde')}</div>
      )}
      <div className="branch-menu-sep" />
      <button type="button" role="menuitem" onClick={() => void reveal()}>
        {t('open.inFileManager')}
      </button>
      {error && <div className="branch-menu-error">{error}</div>}
    </ContextMenuPortal>
  )
}
