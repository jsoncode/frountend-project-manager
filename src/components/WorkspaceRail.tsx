import { Add, Folder2, Refresh, Trash } from 'reicon-react'
import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { ModalShell } from './ModalShell'
import { OpenWithMenu } from './OpenWithMenu'

export function WorkspaceRail() {
  const config = useSettingsStore((s) => s.config)
  const saveWorkspaces = useSettingsStore((s) => s.saveWorkspaces)
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace)
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace)
  const refreshAllProjects = useWorkspaceStore((s) => s.refreshAllProjects)
  const dropWorkspaceCache = useWorkspaceStore((s) => s.dropWorkspaceCache)
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(
    null,
  )
  const { t } = useI18n()

  const addWorkspace = async () => {
    const path = await invoke<string | null>('pick_directory')
    if (!path || !config) return
    if (config.workspaces.includes(path)) {
      setActiveWorkspace(path)
      return
    }
    const next = [...config.workspaces, path]
    await saveWorkspaces(next)
    setActiveWorkspace(path)
  }

  const confirmRemove = async () => {
    if (!config || !pendingRemove) return
    const path = pendingRemove
    const next = config.workspaces.filter((w) => w !== path)
    await saveWorkspaces(next)
    dropWorkspaceCache(path)
    if (activeWorkspace === path) {
      setActiveWorkspace(next[0] ?? null)
    }
    setPendingRemove(null)
  }

  const shortName = (ws: string) =>
    ws.split(/[/\\]/).filter(Boolean).slice(-1)[0] || ws

  return (
    <aside className="rail">
      <div className="pane-title-row">
        <div className="pane-title">{t('ws.title')}</div>
        <div className="pane-title-actions">
          <button
            type="button"
            className="icon-btn"
            title={t('ws.addTitle')}
            aria-label={t('ws.addTitle')}
            onClick={() => void addWorkspace()}
          >
            <Add className="ui-icon" size={18} color="currentColor" aria-hidden />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t('ws.refreshTitle')}
            aria-label={t('ws.refreshTitle')}
            onClick={() => void refreshAllProjects()}
          >
            <Refresh className="ui-icon" size={18} color="currentColor" aria-hidden />
          </button>
        </div>
      </div>
      <div className="scroll">
        {(config?.workspaces ?? []).map((ws) => (
          <div
            key={ws}
            className={`rail-item ${activeWorkspace === ws ? 'active' : ''}`}
            onClick={() => setActiveWorkspace(ws)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu({ path: ws, x: e.clientX, y: e.clientY })
            }}
            title={ws}
          >
            <span className="rail-item-folder" aria-hidden>
              <Folder2 size={22} color="currentColor" weight="Filled" />
            </span>
            <div className="rail-item-body">
              <div className="rail-item-name">{shortName(ws)}</div>
              <div className="muted path-ellipsis">{ws}</div>
            </div>
            <button
              type="button"
              className="rail-item-delete"
              title={t('ws.removeTitle')}
              aria-label={t('ws.removeTitle')}
              onClick={(e) => {
                e.stopPropagation()
                setPendingRemove(ws)
              }}
            >
              <Trash className="ui-icon" size={12} color="currentColor" aria-hidden />
            </button>
          </div>
        ))}
        {(config?.workspaces.length ?? 0) === 0 && (
          <div className="empty">{t('ws.empty')}</div>
        )}
      </div>

      {menu && (
        <OpenWithMenu
          path={menu.path}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}

      {pendingRemove && (
        <ModalShell title={t('ws.removeTitle')} onClose={() => setPendingRemove(null)}>
          <p className="muted">
            {t('ws.removeConfirm', { name: shortName(pendingRemove) })}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setPendingRemove(null)}>
              {t('branch.cancel')}
            </button>
            <button
              type="button"
              className="btn danger btn-with-icon"
              onClick={() => void confirmRemove()}
            >
              <Trash className="ui-icon" size={14} color="currentColor" aria-hidden />
              {t('ws.remove')}
            </button>
          </div>
        </ModalShell>
      )}
    </aside>
  )
}
