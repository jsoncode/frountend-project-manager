import { Add, TerminalSquare, X } from 'reicon-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { focusTerminal } from '../lib/ptyHost'
import { useProjectStore } from '../stores/projectStore'
import { useTerminalStore } from '../stores/terminalStore'
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
  const issueAlerts = useTerminalStore((s) => s.issueAlerts)
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
        {sessions.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`terminal-tab ${s.id === activeId ? 'active' : ''}`}
            onClick={() => activateTab(s.id)}
          >
            <span
              className={`term-dot${s.running ? ' running' : ''}`}
              title={s.running ? t('term.running') : t('term.idle')}
            />
            {s.title}
            {issueAlerts[s.id] ? (
              <Tooltip title={t('term.aiAnalyzeHint')}>
                <span
                  className={`term-issue-dot ${issueAlerts[s.id]!.kind}`}
                />
              </Tooltip>
            ) : null}
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
        {active ? (
          <span className="terminal-status muted">
            {active.connected ? t('term.connected') : t('term.disconnected')}
          </span>
        ) : null}
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
