import { Atom, ChatRoundDots, Settings } from 'reicon-react'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from '../i18n/useI18n'
import { isTauri } from '../lib/tauri'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { SearchBox } from './SearchBox'

export function TopBar() {
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace)
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen)
  const { t } = useI18n()

  const openAi = () => {
    if (!isTauri()) return
    void invoke('ai_open_chat_window', { feedText: null }).catch(() => undefined)
  }

  return (
    <header className="topbar">
      <div className="brand">
        <Atom className="ui-icon" size={18} color="currentColor" aria-hidden />
        FPM
      </div>
      <div className="topbar-path" title={activeWorkspace ?? undefined}>
        {activeWorkspace ?? t('app.noWorkspace')}
      </div>
      <div className="topbar-end">
        <SearchBox />
        <button
          type="button"
          className="btn icon-only"
          title={t('top.settings')}
          aria-label={t('top.settings')}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="ui-icon" size={16} color="currentColor" aria-hidden />
        </button>
        <button
          type="button"
          className="btn primary btn-with-icon"
          title={t('top.aiTitle')}
          onClick={openAi}
        >
          <ChatRoundDots className="ui-icon" size={15} color="currentColor" aria-hidden />
          {t('top.ai')}
        </button>
      </div>
    </header>
  )
}
