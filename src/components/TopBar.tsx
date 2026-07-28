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
import { Tooltip } from './Tooltip'
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
        <Tooltip title="FPM">
          <div className="brand" aria-label="FPM">
            <Atom className="ui-icon" size={16} color="currentColor" aria-hidden />
          </div>
        </Tooltip>
        <TitleFileMenu />
        <Tooltip title={titlePath ?? undefined}>
          <div className="topbar-path-wrap">
            <span className="topbar-path">{titleLabel}</span>
          </div>
        </Tooltip>
      </div>
      <div className="topbar-center">
        <SearchBox />
      </div>
      <div className="topbar-end">
        <Tooltip title={t('top.settings')}>
          <button
            type="button"
            className="btn icon-only"
            aria-label={t('top.settings')}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="ui-icon" size={16} color="currentColor" aria-hidden />
          </button>
        </Tooltip>
        <Tooltip title={t('top.aiTitle')}>
          <button
            type="button"
            className="btn primary btn-with-icon ai-launch-btn"
            onClick={openAi}
          >
            <ChatRoundDots className="ui-icon" size={15} color="currentColor" aria-hidden />
            {t('top.ai')}
          </button>
        </Tooltip>
        <WindowControls />
      </div>
    </header>
  )
}
