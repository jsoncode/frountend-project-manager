import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { useI18n } from '../i18n/useI18n'
import {
  createReadyGate,
  fitTerminal,
  focusTerminal,
  getTerminalSize,
  markPtyReady,
  registerPtyTerminal,
  unregisterPtyTerminal,
} from '../lib/ptyHost'
import { isTauri } from '../lib/tauri'
import { useTerminalStore } from '../stores/terminalStore'
import { ContextMenuPortal } from './ContextMenuPortal'
import '@xterm/xterm/css/xterm.css'

type Props = {
  sessionId: string
  cwd: string
  active: boolean
}

type TermMenu = {
  x: number
  y: number
  hasSelection: boolean
  selection: string
}

export function XtermSession({ sessionId, cwd, active }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const activeRef = useRef(active)
  const markConnected = useTerminalStore((s) => s.markConnected)
  const { t } = useI18n()
  const [menu, setMenu] = useState<TermMenu | null>(null)
  activeRef.current = active

  const closeMenu = useCallback(() => setMenu(null), [])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !isTauri()) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, ui-monospace, monospace",
      // Integer-friendly line box avoids half-row clipping at the bottom.
      lineHeight: 1.0,
      theme: {
        background: '#071018',
        foreground: '#e0f7fa',
        cursor: '#22d3ee',
        cursorAccent: '#071018',
        selectionBackground: 'rgba(34, 211, 238, 0.35)',
        black: '#0b1220',
        red: '#fb7185',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#38bdf8',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e0f7fa',
        brightBlack: '#64748b',
        brightRed: '#fb7185',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#38bdf8',
        brightMagenta: '#c084fc',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
      scrollback: 5000,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void open(uri)
      }),
    )

    const gate = createReadyGate()
    registerPtyTerminal(sessionId, term, fit, gate)
    termRef.current = term
    term.open(host)
    fit.fit()

    let disposed = false

    // With a mouse selection, Ctrl+C / Cmd+C copies instead of sending interrupt (^C).
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true
      const mod = ev.ctrlKey || ev.metaKey
      if (!mod || ev.altKey || ev.shiftKey) return true
      const isC = ev.code === 'KeyC' || ev.key.toLowerCase() === 'c'
      if (!isC || !term.hasSelection()) return true
      const text = term.getSelection()
      if (text) {
        void navigator.clipboard.writeText(text).catch(() => undefined)
      }
      ev.preventDefault()
      ev.stopPropagation()
      return false
    })

    const onData = term.onData((data) => {
      void invoke('pty_write', { terminalId: sessionId, data }).catch(() => undefined)
    })

    const boot = async () => {
      try {
        fit.fit()
        await invoke('pty_spawn', {
          terminalId: sessionId,
          cwd,
          cols: term.cols,
          rows: term.rows,
        })
        if (disposed) {
          await invoke('pty_kill', { terminalId: sessionId }).catch(() => undefined)
          return
        }
        markConnected(sessionId, true)
        markPtyReady(sessionId)
      } catch (e) {
        term.writeln(`\x1b[31mFailed to start shell: ${String(e)}\x1b[0m`)
        markConnected(sessionId, false)
        markPtyReady(sessionId)
      }
    }
    void boot()

    const resizeObs = new ResizeObserver(() => {
      if (!activeRef.current) return
      fitTerminal(sessionId)
      void invoke('pty_resize', {
        terminalId: sessionId,
        cols: term.cols,
        rows: term.rows,
      }).catch(() => undefined)
    })
    resizeObs.observe(host)

    return () => {
      disposed = true
      onData.dispose()
      resizeObs.disconnect()
      termRef.current = null
      unregisterPtyTerminal(sessionId)
      void invoke('pty_kill', { terminalId: sessionId }).catch(() => undefined)
      markConnected(sessionId, false)
    }
    // sessionId/cwd fixed for lifetime of a tab
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, cwd])

  useEffect(() => {
    if (!active) return
    const t = window.setTimeout(() => {
      fitTerminal(sessionId)
      const size = getTerminalSize(sessionId)
      if (size) {
        void invoke('pty_resize', {
          terminalId: sessionId,
          cols: size.cols,
          rows: size.rows,
        }).catch(() => undefined)
      }
      focusTerminal(sessionId)
    }, 30)
    return () => window.clearTimeout(t)
  }, [active, sessionId])

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const term = termRef.current
    const hasSelection = Boolean(term?.hasSelection())
    const selection = hasSelection ? (term?.getSelection() ?? '') : ''
    setMenu({
      x: e.clientX,
      y: e.clientY,
      hasSelection: hasSelection && selection.length > 0,
      selection,
    })
  }

  const copySelection = () => {
    if (!menu?.hasSelection || !menu.selection) return
    void navigator.clipboard.writeText(menu.selection).catch(() => undefined)
    setMenu(null)
  }

  const selectAll = () => {
    termRef.current?.selectAll()
    setMenu(null)
  }

  const feedAi = () => {
    if (!menu?.hasSelection || !menu.selection) return
    const feedText = menu.selection
    setMenu(null)
    if (!isTauri()) return
    void invoke('ai_open_chat_window', { feedText }).catch(() => undefined)
  }

  return (
    <div
      className={`xterm-session ${active ? 'active' : ''}`}
      hidden={!active}
      onContextMenu={onContextMenu}
    >
      {/* FitAddon must measure an unpadded box; padding lives on the outer shell. */}
      <div className="xterm-fit-host" ref={hostRef} />
      {menu && (
        <ContextMenuPortal x={menu.x} y={menu.y} onClose={closeMenu}>
          <button
            type="button"
            role="menuitem"
            disabled={!menu.hasSelection}
            onClick={copySelection}
          >
            {t('term.ctx.copy')}
          </button>
          <button type="button" role="menuitem" onClick={selectAll}>
            {t('term.ctx.selectAll')}
          </button>
          <div className="branch-menu-sep" />
          <button
            type="button"
            role="menuitem"
            disabled={!menu.hasSelection}
            onClick={feedAi}
          >
            {t('term.ctx.feedAi')}
          </button>
        </ContextMenuPortal>
      )}
    </div>
  )
}
