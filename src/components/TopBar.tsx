import { Atom, ChatRoundDots, Settings } from 'reicon-react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { MouseEvent } from 'react'
import { useI18n } from '../i18n/useI18n'
import { isTauri } from '../lib/tauri'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { SearchBox } from './SearchBox'
import { TitleFileMenu } from './TitleFileMenu'
import { WindowControls } from './WindowControls'

/** Interactive chrome — must not start a window drag. */
const NO_DRAG_CLOSEST =
  'button, input, a, select, textarea, label, .search-wrap, .title-menu, .window-controls'

export function TopBar() {
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace)
  const selectedProject = useProjectStore((s) => s.selected)
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen)
  const { t } = useI18n()

  const titlePath = selectedProject?.path ?? activeWorkspace
  const titleLabel = selectedProject?.path
    ?? activeWorkspace
    ?? t('app.noWorkspace')

  const openAi = () => {
    if (!isTauri()) return
    void invoke('ai_open_chat_window', { feedText: null }).catch(() => undefined)
  }

  const onTitlebarMouseDown = (e: MouseEvent) => {
    if (!isTauri()) return
    if (e.button !== 0) return
    const target = e.target
    if (
      target instanceof Element &&
      target.closest(NO_DRAG_CLOSEST)
    ) {
      return
    }
    if (e.detail === 2) {
      void getCurrentWindow().toggleMaximize()
      return
    }
    void getCurrentWindow().startDragging()
  }

  return (
    <header className="topbar titlebar" onMouseDown={onTitlebarMouseDown}>
      <div className="topbar-left">
        <div className="brand" title="FPM" aria-label="FPM">
          <Atom className="ui-icon" size={16} color="currentColor" aria-hidden />
        </div>
        <TitleFileMenu />
        <div className="topbar-path-wrap" title={titlePath ?? undefined}>
          <span className="topbar-path">{titleLabel}</span>
        </div>
      </div>
      <div className="topbar-center">
        <SearchBox />
      </div>
      <div className="topbar-end">
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
          className="btn primary btn-with-icon ai-launch-btn"
          title={t('top.aiTitle')}
          onClick={openAi}
        >
          <ChatRoundDots className="ui-icon" size={15} color="currentColor" aria-hidden />
          {t('top.ai')}
        </button>
        <WindowControls />
      </div>
    </header>
  )
}
