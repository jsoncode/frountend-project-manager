import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal, type ILink, type ILinkProvider } from '@xterm/xterm'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useI18n } from '../i18n/useI18n'
import { findFilePathsInLine } from '../lib/termFileLinks'
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
import { useEditorStore } from '../stores/editorStore'
import { useExplorerStore } from '../stores/explorerStore'
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
  filePath?: string
}

/** Assemble wrapped buffer rows so long paths remain one logical string. */
function getLogicalLine(
  terminal: Terminal,
  row0: number,
): { text: string; rowStart: number; rowTextLen: number } | null {
  const buffer = terminal.buffer.active
  const current = buffer.getLine(row0)
  if (!current) return null

  let start = row0
  while (start > 0 && buffer.getLine(start)?.isWrapped) {
    start -= 1
  }

  let text = ''
  let rowStart = 0
  let rowTextLen = 0
  let r = start
  for (;;) {
    const line = buffer.getLine(r)
    if (!line) break
    const next = buffer.getLine(r + 1)
    const wraps = Boolean(next?.isWrapped)
    const piece = wraps
      ? line.translateToString(false).slice(0, terminal.cols)
      : line.translateToString(true)
    if (r === row0) {
      rowStart = text.length
      rowTextLen = piece.length
    }
    text += piece
    if (!wraps) break
    r += 1
  }

  return { text, rowStart, rowTextLen }
}

function createFilePathLinkProvider(
  terminal: Terminal,
  onPathActivate: (event: MouseEvent, path: string) => void,
): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const row0 = y - 1
      const logical = getLogicalLine(terminal, row0)
      if (!logical || logical.rowTextLen <= 0) {
        callback(undefined)
        return
      }
      const matches = findFilePathsInLine(logical.text)
      if (matches.length === 0) {
        callback(undefined)
        return
      }
      const rowEnd = logical.rowStart + logical.rowTextLen
      const links: ILink[] = []
      for (const m of matches) {
        const overlapStart = Math.max(m.start, logical.rowStart)
        const overlapEnd = Math.min(m.end, rowEnd)
        if (overlapStart >= overlapEnd) continue
        links.push({
          text: m.path,
          range: {
            start: { x: overlapStart - logical.rowStart + 1, y },
            end: { x: overlapEnd - logical.rowStart, y },
          },
          activate: (event) => onPathActivate(event, m.path),
        })
      }
      callback(links.length > 0 ? links : undefined)
    },
  }
}

export function XtermSession({ sessionId, cwd, active }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const cwdRef = useRef(cwd)
  const activeRef = useRef(active)
  const markConnected = useTerminalStore((s) => s.markConnected)
  const { t } = useI18n()
  const [menu, setMenu] = useState<TermMenu | null>(null)
  /** Path-link handler already opened a menu; skip the host contextmenu overwrite. */
  const pathMenuFromLinkRef = useRef(false)
  /** After a path-link click, suppress xterm drag-selection for a short window. */
  const suppressSelectUntilRef = useRef(0)
  activeRef.current = active
  cwdRef.current = cwd

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
    const clearLinkSelection = () => {
      term.clearSelection()
    }

    /** Track pointer down to distinguish click vs drag-select on links. */
    const pointerDownRef = { x: 0, y: 0 }
    const onPointerDown = (e: MouseEvent) => {
      pointerDownRef.x = e.clientX
      pointerDownRef.y = e.clientY
    }
    host.addEventListener('mousedown', onPointerDown, true)

    const shouldIgnoreLinkOpen = (event: MouseEvent) => {
      // Right / middle never auto-open.
      if (event.button !== 0) return true
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return true
      }
      // Drag-select ending on a link must not open (xterm fires activate on mouseup).
      const dx = Math.abs(event.clientX - pointerDownRef.x)
      const dy = Math.abs(event.clientY - pointerDownRef.y)
      if (dx > 3 || dy > 3) return true
      const sel = term.getSelection()
      if (term.hasSelection() && sel.trim().length > 0) return true
      return false
    }

    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (shouldIgnoreLinkOpen(event)) return
        void open(uri)
      }),
    )

    const fileLinks = term.registerLinkProvider(
      createFilePathLinkProvider(term, (event, path) => {
        event.preventDefault()
        event.stopPropagation()

        const hadSelection =
          term.hasSelection() && (term.getSelection()?.trim().length ?? 0) > 0
        const selection = hadSelection ? (term.getSelection() ?? '') : ''

        // Right-click / modifier: show path menu; keep selection so Copy works.
        if (event.button === 2 || event.ctrlKey || event.metaKey) {
          pathMenuFromLinkRef.current = true
          setMenu({
            x: event.clientX,
            y: event.clientY,
            hasSelection: selection.length > 0,
            selection,
            filePath: path,
          })
          return
        }

        if (shouldIgnoreLinkOpen(event)) {
          return
        }

        // Primary click only: open folder / reveal file in the system file manager.
        suppressSelectUntilRef.current = Date.now() + 400
        clearLinkSelection()
        queueMicrotask(clearLinkSelection)
        window.setTimeout(clearLinkSelection, 0)
        window.setTimeout(clearLinkSelection, 50)
        void invoke('reveal_in_file_manager', { path }).catch(() => undefined)
      }),
    )

    const onMouseSettle = () => {
      if (Date.now() <= suppressSelectUntilRef.current) {
        clearLinkSelection()
      }
    }
    host.addEventListener('mouseup', onMouseSettle, true)
    host.addEventListener('mousemove', onMouseSettle, true)

    const gate = createReadyGate()
    registerPtyTerminal(sessionId, term, fit, gate)
    termRef.current = term
    term.open(host)
    fit.fit()

    let disposed = false
    let readyFallbackTimer: number | undefined

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
      // Enter / Ctrl+C etc. means the shell was used — confirm before close.
      if (data.includes('\r') || data.includes('\n') || data === '\u0003') {
        useTerminalStore.getState().markDirty(sessionId)
      }
      // Interactive Enter → treat as busy until the prompt heuristic clears it.
      if (data === '\r' || data.endsWith('\r') || data.includes('\n')) {
        useTerminalStore.getState().markRunning(sessionId, true)
      }
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
        // Do NOT markPtyReady here — wait for the first interactive prompt
        // (see terminalStore pty://data). Profiles / -Command may still be
        // rewriting PATH; sending shortcut commands too early → "not found".
        readyFallbackTimer = window.setTimeout(() => {
          if (!disposed) markPtyReady(sessionId)
        }, 8000)
      } catch (e) {
        if (disposed) return
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

    // Ctrl+wheel (Cmd+wheel on macOS) to zoom terminal font size.
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
    const plat = (nav.userAgentData?.platform ?? navigator.platform ?? '').toLowerCase()
    const isMac = plat.includes('mac') || plat.includes('iphone') || plat.includes('ipad')
    const onWheelZoom = (e: WheelEvent) => {
      const zoomKey = isMac ? e.metaKey : e.ctrlKey
      if (!zoomKey) return
      e.preventDefault()
      const current = term.options.fontSize ?? 13
      const delta = e.deltaY < 0 ? 1 : -1
      const next = Math.min(32, Math.max(8, current + delta))
      if (next === current) return
      term.options.fontSize = next
      fit.fit()
      void invoke('pty_resize', {
        terminalId: sessionId,
        cols: term.cols,
        rows: term.rows,
      }).catch(() => undefined)
    }
    // Use { passive: false } so preventDefault works.
    host.addEventListener('wheel', onWheelZoom, { passive: false })

    return () => {
      disposed = true
      if (readyFallbackTimer != null) window.clearTimeout(readyFallbackTimer)
      onData.dispose()
      fileLinks.dispose()
      host.removeEventListener('mouseup', onMouseSettle, true)
      host.removeEventListener('mousemove', onMouseSettle, true)
      host.removeEventListener('mousedown', onPointerDown, true)
      host.removeEventListener('wheel', onWheelZoom)
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

  const onContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (pathMenuFromLinkRef.current) {
      pathMenuFromLinkRef.current = false
      return
    }
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

  const copyFilePath = () => {
    if (!menu?.filePath) return
    void navigator.clipboard.writeText(menu.filePath).catch(() => undefined)
    setMenu(null)
  }

  const revealFilePath = () => {
    const path = menu?.filePath
    if (!path) return
    setMenu(null)
    void invoke('reveal_in_file_manager', { path }).catch(() => undefined)
  }

  const openFilePath = () => {
    const path = menu?.filePath
    if (!path) return
    setMenu(null)
    const projectPath = cwdRef.current
    useEditorStore.getState().openTab(path, projectPath)
    useExplorerStore.getState().setSelection({
      kind: 'file',
      path,
      projectPath,
    })
  }

  return (
    <div
      ref={hostRef}
      className={`xterm-session ${active ? 'active' : ''}`}
      hidden={!active}
      onContextMenu={onContextMenu}
    >
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
          <button
            type="button"
            role="menuitem"
            disabled={!menu.hasSelection}
            onClick={feedAi}
          >
            {t('term.ctx.feedAi')}
          </button>
          {menu.filePath && (
            <>
              <div className="branch-menu-sep" />
              <button type="button" role="menuitem" onClick={revealFilePath}>
                {t('term.ctx.revealPath')}
              </button>
              <button type="button" role="menuitem" onClick={copyFilePath}>
                {t('term.ctx.copyPath')}
              </button>
              <button type="button" role="menuitem" onClick={openFilePath}>
                {t('term.ctx.openFile')}
              </button>
            </>
          )}
        </ContextMenuPortal>
      )}
    </div>
  )
}
