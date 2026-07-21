import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useI18n } from '../i18n/useI18n'
import { renderAnsi } from '../lib/ansi'
import { useProjectStore } from '../stores/projectStore'
import { useTerminalStore } from '../stores/terminalStore'
import { ModalShell } from './ModalShell'

export function TerminalPanel() {
  const sessions = useTerminalStore((s) => s.sessions)
  const activeId = useTerminalStore((s) => s.activeId)
  const setActive = useTerminalStore((s) => s.setActive)
  const createSession = useTerminalStore((s) => s.createSession)
  const closeSession = useTerminalStore((s) => s.closeSession)
  const setInput = useTerminalStore((s) => s.setInput)
  const clearSession = useTerminalStore((s) => s.clearSession)
  const runInSession = useTerminalStore((s) => s.runInSession)
  const killSession = useTerminalStore((s) => s.killSession)
  const writeStdin = useTerminalStore((s) => s.writeStdin)
  const selected = useProjectStore((s) => s.selected)
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const { t } = useI18n()

  const active = sessions.find((s) => s.id === activeId) ?? null
  const pendingClose = sessions.find((s) => s.id === pendingCloseId) ?? null

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [active?.lines, active?.input, activeId])

  useEffect(() => {
    if (activeId) bodyRef.current?.focus()
  }, [activeId])

  const addTerminal = () => {
    if (!selected) return
    createSession(selected.path, selected.folderName)
  }

  const requestClose = (id: string) => {
    const session = sessions.find((s) => s.id === id)
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

  const onTerminalKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!active) return

    // Let shortcuts with modifiers pass (except Ctrl+C while running → SIGINT-ish via Ctrl+C char)
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if (active.running && e.key.toLowerCase() === 'c' && !e.shiftKey) {
        e.preventDefault()
        void writeStdin(active.id, '\x03')
      }
      return
    }

    if (active.running) {
      e.preventDefault()
      if (e.key === 'Enter') {
        void writeStdin(active.id, '\r\n')
        setInput(active.id, '')
        return
      }
      if (e.key === 'Backspace') {
        void writeStdin(active.id, '\x7f')
        setInput(active.id, active.input.slice(0, -1))
        return
      }
      if (e.key === 'Escape') {
        void writeStdin(active.id, '\x1b')
        return
      }
      if (e.key.length === 1) {
        void writeStdin(active.id, e.key)
        setInput(active.id, active.input + e.key)
      }
      return
    }

    // Idle: compose command inline in the terminal body
    if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = active.input.trim()
      if (!cmd) return
      void runInSession(active.id, active.projectPath, cmd)
      return
    }
    if (e.key === 'Backspace') {
      e.preventDefault()
      setInput(active.id, active.input.slice(0, -1))
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      setInput(active.id, `${active.input}  `)
      return
    }
    if (e.key.length === 1) {
      e.preventDefault()
      setInput(active.id, active.input + e.key)
    }
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
              <span className={s.running ? 'term-dot running' : 'term-dot'} />
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
                {active.running ? t('term.running') : t('term.idle')}
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
                disabled={!active.running}
                onClick={() => void killSession(active.id)}
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

      {active && (
        <div
          className="terminal-body terminal-body-interactive"
          ref={bodyRef}
          tabIndex={0}
          role="textbox"
          aria-label={t('term.interactiveHint')}
          onKeyDown={onTerminalKeyDown}
          onClick={() => bodyRef.current?.focus()}
        >
          {active.lines.map((l, i) => (
            <div key={`${active.id}-${i}`} className={`term-line ${l.stream}`}>
              {l.stream === 'system' || l.stream === 'stdin'
                ? l.line
                : renderAnsi(l.line, `${active.id}-${i}`)}
            </div>
          ))}
          {!active.running && (
            <div className="term-line term-prompt-line">
              <span className="term-prompt">$</span>
              <span className="term-draft">{active.input}</span>
              <span className="term-caret" />
            </div>
          )}
          {active.running && (
            <div className="term-line term-prompt-line">
              <span className="term-draft stdin">{active.input}</span>
              <span className="term-caret" />
            </div>
          )}
        </div>
      )}

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
