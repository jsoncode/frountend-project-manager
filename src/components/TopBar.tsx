import { useI18n } from '../i18n/useI18n'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { SearchBox } from './SearchBox'

export function TopBar() {
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace)
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen)
  const { t } = useI18n()

  return (
    <header className="topbar">
      <div className="brand">◈ FPM</div>
      <div className="topbar-path" title={activeWorkspace ?? undefined}>
        {activeWorkspace ?? t('app.noWorkspace')}
      </div>
      <div className="topbar-end">
        <SearchBox />
        <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>
          {t('top.settings')}
        </button>
      </div>
    </header>
  )
}
