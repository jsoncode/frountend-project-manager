import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { focusTerminal } from '../lib/ptyHost'
import { useProjectStore } from '../stores/projectStore'
import { useTerminalStore } from '../stores/terminalStore'
import { ModalShell } from './ModalShell'
import { XtermSession } from './XtermSession'

export function TerminalPanel() {
  const sessions = useTerminalStore((s) => s.sessions)
  const activeId = useTerminalStore((s) => s.activeId)
  const setActive = useTerminalStore((s) => s.setActive)
  const createSession = useTerminalStore((s) => s.createSession)
  const closeSession = useTerminalStore((s) => s.closeSession)
  const clearSession = useTerminalStore((s) => s.clearSession)
  const killSession = useTerminalStore((s) => s.killSession)
  const selected = useProjectStore((s) => s.selected)
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null)
  const { t } = useI18n()

  const active = sessions.find((s) => s.id === activeId) ?? null
  const pendingClose = sessions.find((s) => s.id === pendingCloseId) ?? null

  useEffect(() => {
    if (activeId) focusTerminal(activeId)
  }, [activeId])

  const addTerminal = () => {
    if (!selected) return
    createSession(selected.path, selected.folderName)
  }

  const requestClose = (id: string) => {
    const session = sessions.find((s) => s.id === id)
    if (session?.connected) {
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
    <div className="terminal">
      <div className="terminal-tabs">
        <div className="terminal-tab-list">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`terminal-tab ${s.id === activeId ? 'active' : ''}`}
              onClick={() => setActive(s.id)}
            >
              <span className={s.connected ? 'term-dot running' : 'term-dot'} />
              {s.title}
              <span
                className="term-close"
                onClick={(e) => {
                  e.stopPropagation()
                  requestClose(s.id)
                }}
              >
                ×
              </span>
            </button>
          ))}
          <button
            type="button"
            className="terminal-tab add"
            disabled={!selected}
            onClick={addTerminal}
            title={t('term.new')}
          >
            +
          </button>
        </div>
        <div className="terminal-tab-actions">
          {active && (
            <>
              <span className="muted">
                {active.connected ? t('term.connected') : t('term.disconnected')}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => clearSession(active.id)}
              >
                {t('term.clear')}
              </button>
              <button
                type="button"
                className="btn btn-sm danger"
                disabled={!active.connected}
                onClick={() => void killSession(active.id)}
                title="Ctrl+C"
              >
                {t('term.stop')}
              </button>
            </>
          )}
        </div>
      </div>

      {!active && (
        <div className="terminal-empty">
          <span className="muted">
            {selected ? t('term.emptySelected') : t('term.emptyNoProject')}
          </span>
          {selected && (
            <button type="button" className="btn btn-sm primary" onClick={addTerminal}>
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
        >
          <p className="muted">
            {t('term.closeRunningDesc', { name: pendingClose.title })}
          </p>
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
        </ModalShell>
      )}
    </div>
  )
}
