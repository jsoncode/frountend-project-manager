import { Add, TerminalSquare, X } from 'reicon-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { findWorkspaceForPath } from '../lib/workspacePath'
import { focusTerminal } from '../lib/ptyHost'
import { useProjectStore } from '../stores/projectStore'
import { explorerRowEls, useExplorerStore } from '../stores/explorerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTerminalStore } from '../stores/terminalStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { ModalShell } from './ModalShell'
import { Tooltip } from './Tooltip'
import { XtermSession } from './XtermSession'

export function TerminalPanel({
  height,
  fill = false,
}: {
  height?: number
  fill?: boolean
}) {
  const sessions = useTerminalStore((s) => s.sessions)
  const activeId = useTerminalStore((s) => s.activeId)
  const setActive = useTerminalStore((s) => s.setActive)
  const createSession = useTerminalStore((s) => s.createSession)
  const closeSession = useTerminalStore((s) => s.closeSession)
  const selected = useProjectStore((s) => s.selected)
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null)
  const { t } = useI18n()

  const active = sessions.find((s) => s.id === activeId) ?? null
  const pendingClose = sessions.find((s) => s.id === pendingCloseId) ?? null

  useEffect(() => {
    if (activeId) focusTerminal(activeId)
  }, [activeId])

  const activateTab = (id: string) => {
    setActive(id)
  }

  /**
   * Clicking a terminal tab locates its project in the Explorer: clears any
   * active search filter, expands the owning workspace (accordion style),
   * selects the project row, then scrolls it to the top of the view.
   */
  const locateProject = (projectPath: string) => {
    const wsStore = useWorkspaceStore.getState()
    const exStore = useExplorerStore.getState()
    const workspaces =
      useSettingsStore.getState().config?.workspaces ?? []
    const ws =
      findWorkspaceForPath(projectPath, workspaces) ?? wsStore.activeWorkspace
    if (!ws) return

    // The row only renders without an active search filter.
    if (wsStore.search.trim()) wsStore.setSearch('')
    // Load the workspace cache if it was never scanned (rows appear async).
    if (wsStore.projectCache[ws] === undefined) {
      void wsStore.ensureWorkspaceCached(ws)
    }
    if (ws !== wsStore.activeWorkspace) wsStore.setActiveWorkspace(ws)
    // Accordion: keep dir expands, ensure only this workspace is open.
    exStore.setExpanded((prev) => {
      const next = prev.filter((x) => x.startsWith('dir:'))
      if (!next.includes(`ws:${ws}`)) next.push(`ws:${ws}`)
      return next
    })
    exStore.setSelection({ kind: 'project', path: projectPath, workspace: ws })

    // Scroll the project row into view (top) once it renders; the row may
    // appear a few frames later when the workspace just expanded/loaded.
    const projId = `proj:${projectPath}`
    let attempts = 0
    const tryScroll = () => {
      const el = explorerRowEls.get(projId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      if (++attempts < 15) window.setTimeout(tryScroll, 100)
    }
    tryScroll()
  }

  const addTerminal = () => {
    if (!selected) return
    createSession(selected.path, selected.folderName)
  }

  const requestClose = (id: string) => {
    const session = sessions.find((s) => s.id === id)
    // Only warn when a foreground command is still running.
    if (session?.running) {
      setPendingCloseId(id)
      return
    }
    void closeSession(id)
  }

  const confirmCloseRunning = async () => {
    if (!pendingCloseId) return
    const id = pendingCloseId
    setPendingCloseId(null)
    await closeSession(id)
  }

  return (
    <div
      className={`terminal${fill ? ' terminal-fill' : ''}`}
      style={fill ? undefined : { height }}
    >
      <div className="terminal-tabs">
        <div className="terminal-tab-list">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`terminal-tab ${s.id === activeId ? 'active' : ''}`}
              onClick={() => {
                activateTab(s.id)
                // Locate the terminal's project in the Explorer.
                locateProject(s.projectPath)
              }}
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault()
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return
                e.preventDefault()
                e.stopPropagation()
                requestClose(s.id)
              }}
            >
              <span
                className={`term-dot${s.running ? ' running' : ''}`}
                title={s.running ? t('term.running') : t('term.idle')}
              />
              {s.title}
              <span
                className="term-close"
                onClick={(e) => {
                  e.stopPropagation()
                  requestClose(s.id)
                }}
              >
                <X className="ui-icon" size={12} color="currentColor" aria-hidden />
              </span>
            </button>
          ))}
        </div>
        <Tooltip title={t('term.new')}>
          <button
            type="button"
            className="terminal-tab add"
            disabled={!selected}
            onClick={addTerminal}
          >
            <Add className="ui-icon" size={14} color="currentColor" aria-hidden />
          </button>
        </Tooltip>
      </div>

      {!active && (
        <div className="terminal-empty">
          <span className="muted">
            {selected ? t('term.emptySelected') : t('term.emptyNoProject')}
          </span>
          {selected && (
            <button type="button" className="btn btn-sm primary btn-with-icon" onClick={addTerminal}>
              <TerminalSquare className="ui-icon" size={14} color="currentColor" aria-hidden />
              {t('term.create')}
            </button>
          )}
        </div>
      )}

      <div className={`terminal-xterm-stack ${active ? '' : 'hidden'}`}>
        {sessions.map((s) => (
          <XtermSession
            key={s.id}
            sessionId={s.id}
            cwd={s.projectPath}
            active={s.id === activeId}
          />
        ))}
      </div>

      {pendingClose && (
        <ModalShell
          title={t('term.closeRunningTitle')}
          onClose={() => setPendingCloseId(null)}
          closeOnEsc={false}
          footer={
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setPendingCloseId(null)}>
                {t('branch.cancel')}
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => void confirmCloseRunning()}
              >
                {t('term.closeRunningConfirm')}
              </button>
            </div>
          }
        >
          <p className="muted">
            {t('term.closeRunningDesc', { name: pendingClose.title })}
          </p>
        </ModalShell>
      )}
    </div>
  )
}
