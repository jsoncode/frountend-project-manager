import { Add, ChatRoundDots, TerminalSquare, X } from 'reicon-react'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { truncateAttachment } from '../lib/aiChat'
import { focusTerminal } from '../lib/ptyHost'
import { isTauri } from '../lib/tauri'
import { useProjectStore } from '../stores/projectStore'
import { useTerminalStore } from '../stores/terminalStore'
import { ModalShell } from './ModalShell'
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
  const clearIssueAlert = useTerminalStore((s) => s.clearIssueAlert)
  const selected = useProjectStore((s) => s.selected)
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null)
  const { t } = useI18n()

  const active = sessions.find((s) => s.id === activeId) ?? null
  const pendingClose = sessions.find((s) => s.id === pendingCloseId) ?? null
  const activeIssue = activeId ? issueAlerts[activeId] : undefined

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
    // Idle unused shell (connected but never ran a command) → close without prompt.
    if (session?.connected && (session.running || session.dirty)) {
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

  const openAi = () => {
    if (!isTauri()) return
    if (activeId && activeIssue) {
      const feedText = truncateAttachment(activeIssue.snippet)
      clearIssueAlert(activeId)
      void invoke('ai_open_chat_window', { feedText }).catch(() => undefined)
      return
    }
    void invoke('ai_open_chat_window', { feedText: null }).catch(() => undefined)
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
            <span className={s.connected ? 'term-dot running' : 'term-dot'} />
            {s.title}
            {issueAlerts[s.id] ? (
              <span
                className={`term-issue-dot ${issueAlerts[s.id]!.kind}`}
                title={t('term.aiAnalyzeHint')}
              />
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
        <button
          type="button"
          className="terminal-tab add"
          disabled={!selected}
          onClick={addTerminal}
          title={t('term.new')}
        >
          <Add className="ui-icon" size={14} color="currentColor" aria-hidden />
        </button>
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

      <div
        className={`term-ai-bar${activeIssue ? ` ${activeIssue.kind}` : ''}`}
        role="status"
        aria-live="polite"
      >
        <span className="term-ai-bar-hint muted">
          {activeIssue
            ? activeIssue.kind === 'error'
              ? t('term.aiAnalyzeErrorHint')
              : t('term.aiAnalyzeWarnHint')
            : t('term.aiAnalyzeIdleHint')}
        </span>
        <button type="button" className="btn btn-sm primary btn-with-icon" onClick={openAi}>
          <ChatRoundDots className="ui-icon" size={14} color="currentColor" aria-hidden />
          {t('term.aiChat')}
        </button>
        {activeIssue && activeId ? (
          <button
            type="button"
            className="term-ai-bar-dismiss"
            title={t('term.aiAnalyzeDismiss')}
            aria-label={t('term.aiAnalyzeDismiss')}
            onClick={() => clearIssueAlert(activeId)}
          >
            <X className="ui-icon" size={14} color="currentColor" aria-hidden />
          </button>
        ) : null}
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
