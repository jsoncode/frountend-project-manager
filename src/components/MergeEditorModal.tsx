import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { useI18n } from '../i18n/useI18n'
import { languageFromPath } from '../lib/editorLanguage'
import {
  applyHunkChoice,
  looksBinary,
  parseConflictHunks,
  type ConflictHunk,
} from '../lib/mergeConflictParse'
import { setupMonacoEnvironment } from '../lib/monacoEnv'
import { registerEditorThemes } from '../lib/monacoThemes'
import type { MergeFileSides } from '../lib/types'
import { useSettingsStore } from '../stores/settingsStore'
import { ModalShell } from './ModalShell'

type Props = {
  projectPath: string
  file: string
  onClose: () => void
  onSaved: () => void | Promise<void>
}

const FONT = "Consolas, 'Courier New', ui-monospace, monospace"
const LINE_HEIGHT = 20

const CONFLICT_DECORATION = {
  isWholeLine: true,
  className: 'merge-conflict-line',
  linesDecorationsClassName: 'merge-conflict-gutter',
}

const CONFLICT_MARKER_DECORATION = {
  isWholeLine: true,
  className: 'merge-conflict-marker-line',
}

function createEditor(
  el: HTMLElement,
  value: string,
  language: string,
  readOnly: boolean,
  theme: string,
): monaco.editor.IStandaloneCodeEditor {
  setupMonacoEnvironment()
  return monaco.editor.create(el, {
    value,
    language,
    readOnly,
    automaticLayout: true,
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: LINE_HEIGHT,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    renderLineHighlight: readOnly ? 'none' : 'line',
    theme,
    lineNumbers: 'on',
    glyphMargin: !readOnly,
    folding: true,
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  })
}

/** Get the line range (1-based) for a hunk in the given text. */
function hunkLineRange(text: string, hunk: ConflictHunk): { start: number; end: number } {
  const before = text.slice(0, hunk.start)
  const startLine = before.split('\n').length
  const hunkLines = hunk.full.split('\n').length
  return { start: startLine, end: startLine + hunkLines - 1 }
}

export function MergeEditorModal({
  projectPath,
  file,
  onClose,
  onSaved,
}: Props) {
  const { t } = useI18n()
  const editorTheme = useSettingsStore((s) => s.config?.editorTheme ?? 'vs-dark')
  const oursRef = useRef<HTMLDivElement>(null)
  const theirsRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const editorsRef = useRef<{
    ours: monaco.editor.IStandaloneCodeEditor | null
    theirs: monaco.editor.IStandaloneCodeEditor | null
    result: monaco.editor.IStandaloneCodeEditor | null
  }>({ ours: null, theirs: null, result: null })
  const decorationsRef = useRef<string[]>([])
  const widgetsRef = useRef<monaco.editor.IContentWidget[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [binary, setBinary] = useState(false)
  const [resultText, setResultText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [hunks, setHunks] = useState<ConflictHunk[]>([])
  const [currentHunk, setCurrentHunk] = useState(0)
  const [busy, setBusy] = useState(false)
  const initialRef = useRef('')
  const syncingScroll = useRef(false)

  const hunkCount = hunks.length

  /** Apply conflict decorations to the result editor. */
  const applyDecorations = useCallback((editor: monaco.editor.IStandaloneCodeEditor, text: string, hunkList: ConflictHunk[]) => {
    const model = editor.getModel()
    if (!model) return

    const decorations: monaco.editor.IModelDeltaDecoration[] = []
    const newWidgets: monaco.editor.IContentWidget[] = []

    hunkList.forEach((hunk, idx) => {
      const range = hunkLineRange(text, hunk)

      // Highlight the entire conflict region (<<<<<< to >>>>>>)
      decorations.push({
        range: new monaco.Range(range.start, 1, range.end, model.getLineMaxColumn(range.end)),
        options: CONFLICT_DECORATION,
      })

      // Highlight the marker lines specifically
      const markerLines = [range.start, range.start + hunk.ours.split('\n').length, range.end]
      for (const line of markerLines) {
        if (line >= 1 && line <= model.getLineCount()) {
          decorations.push({
            range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)),
            options: CONFLICT_MARKER_DECORATION,
          })
        }
      }

      // Add content widget with action buttons at the <<<<<<< line
      const widgetId = `merge-hunk-${idx}`
      const domNode = document.createElement('div')
      domNode.className = 'merge-hunk-widget'

      const label = document.createElement('span')
      label.className = 'merge-hunk-widget-label'
      label.textContent = `${idx + 1}/${hunkList.length}`
      domNode.appendChild(label)

      const mkBtn = (choice: 'ours' | 'theirs' | 'both', text: string, title: string) => {
        const btn = document.createElement('button')
        btn.className = `btn btn-xs merge-hunk-btn ${choice}`
        btn.textContent = text
        btn.title = title
        btn.dataset.choice = choice
        btn.addEventListener('click', () => applyHunkAt(idx, choice))
        return btn
      }
      domNode.appendChild(mkBtn('ours', `← ${t('merge.hunkOurs')}`, t('merge.hunkOurs')))
      domNode.appendChild(mkBtn('theirs', `${t('merge.hunkTheirs')} →`, t('merge.hunkTheirs')))
      domNode.appendChild(mkBtn('both', t('merge.hunkBoth'), t('merge.hunkBoth')))

      const widget: monaco.editor.IContentWidget = {
        getId: () => widgetId,
        getDomNode: () => domNode,
        getPosition: () => ({
          position: { lineNumber: range.start, column: 1 },
          preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE],
        }),
      }
      editor.addContentWidget(widget)
      newWidgets.push(widget)
    })

    // Remove old decorations and widgets
    if (decorationsRef.current.length > 0) {
      editor.deltaDecorations(decorationsRef.current, [])
    }
    for (const w of widgetsRef.current) {
      editor.removeContentWidget(w)
    }

    decorationsRef.current = editor.deltaDecorations([], decorations)
    widgetsRef.current = newWidgets
  }, [t])

  /** Apply a choice to a specific hunk index. */
  const applyHunkAt = useCallback((idx: number, choice: 'ours' | 'theirs' | 'both') => {
    const ed = editorsRef.current.result
    if (!ed) return
    const text = ed.getValue()
    const hunkList = parseConflictHunks(text)
    const hunk = hunkList[idx]
    if (!hunk) return
    const next = applyHunkChoice(text, hunk, choice)
    ed.setValue(next)
  }, [])

  /** Navigate to a specific hunk in the result editor. */
  const goToHunk = useCallback((idx: number) => {
    const ed = editorsRef.current.result
    if (!ed) return
    const text = ed.getValue()
    const hunkList = parseConflictHunks(text)
    if (idx < 0 || idx >= hunkList.length) return
    const range = hunkLineRange(text, hunkList[idx])
    ed.revealLineInCenter(range.start)
    ed.setPosition({ lineNumber: range.start, column: 1 })
    ed.focus()
    setCurrentHunk(idx)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const sides = await invoke<MergeFileSides>('git_merge_file_sides', {
          path: projectPath,
          file,
        })
        if (cancelled) return
        if (
          looksBinary(sides.ours) ||
          looksBinary(sides.theirs) ||
          looksBinary(sides.working)
        ) {
          setBinary(true)
          setLoading(false)
          return
        }
        const lang = languageFromPath(file)
        setResultText(sides.working)
        initialRef.current = sides.working
        const initialHunks = parseConflictHunks(sides.working)
        setHunks(initialHunks)
        setCurrentHunk(0)
        setLoading(false)

        // Create editors after DOM paints
        requestAnimationFrame(() => {
          if (cancelled) return
          registerEditorThemes(monaco)
          if (oursRef.current && !editorsRef.current.ours) {
            editorsRef.current.ours = createEditor(
              oursRef.current,
              sides.ours,
              lang,
              true,
              editorTheme,
            )
          }
          if (theirsRef.current && !editorsRef.current.theirs) {
            editorsRef.current.theirs = createEditor(
              theirsRef.current,
              sides.theirs,
              lang,
              true,
              editorTheme,
            )
          }
          if (resultRef.current && !editorsRef.current.result) {
            const ed = createEditor(resultRef.current, sides.working, lang, false, editorTheme)
            editorsRef.current.result = ed
            ed.onDidChangeModelContent(() => {
              const v = ed.getValue()
              setResultText(v)
              setDirty(v !== initialRef.current)
              const newHunks = parseConflictHunks(v)
              setHunks(newHunks)
              applyDecorations(ed, v, newHunks)
              setCurrentHunk((prev) => Math.min(prev, Math.max(0, newHunks.length - 1)))
            })

            // Apply initial decorations
            applyDecorations(ed, sides.working, initialHunks)

            // Sync scroll between panes
            const syncScroll = (source: monaco.editor.IStandaloneCodeEditor, targets: monaco.editor.IStandaloneCodeEditor[]) => {
              source.onDidScrollChange(() => {
                if (syncingScroll.current) return
                syncingScroll.current = true
                const scrollTop = source.getScrollTop()
                const scrollLeft = source.getScrollLeft()
                for (const target of targets) {
                  target.setScrollPosition({ scrollTop, scrollLeft })
                }
                requestAnimationFrame(() => { syncingScroll.current = false })
              })
            }
            const ours = editorsRef.current.ours
            const theirs = editorsRef.current.theirs
            if (ours) syncScroll(ours, [ed, theirs!].filter(Boolean))
            if (theirs) syncScroll(theirs, [ed, ours!].filter(Boolean))
            syncScroll(ed, [ours!, theirs!].filter(Boolean))

            // Jump to first conflict
            if (initialHunks.length > 0) {
              goToHunk(0)
            }
          }
        })
      } catch (e) {
        if (!cancelled) {
          setError(String(e))
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      for (const key of ['ours', 'theirs', 'result'] as const) {
        editorsRef.current[key]?.dispose()
        editorsRef.current[key] = null
      }
    }
  }, [projectPath, file])

  const applyChoice = useCallback((choice: 'ours' | 'theirs' | 'both') => {
    applyHunkAt(currentHunk, choice)
  }, [currentHunk, applyHunkAt])

  const prevConflict = useCallback(() => {
    if (currentHunk > 0) goToHunk(currentHunk - 1)
  }, [currentHunk, goToHunk])

  const nextConflict = useCallback(() => {
    if (currentHunk < hunkCount - 1) goToHunk(currentHunk + 1)
  }, [currentHunk, hunkCount, goToHunk])

  const acceptAllOurs = useCallback(() => {
    const ours = editorsRef.current.ours?.getValue()
    if (ours != null) {
      editorsRef.current.result?.setValue(ours)
    }
  }, [])

  const acceptAllTheirs = useCallback(() => {
    const theirs = editorsRef.current.theirs?.getValue()
    if (theirs != null) {
      editorsRef.current.result?.setValue(theirs)
    }
  }, [])

  const tryClose = () => {
    if (dirty && !window.confirm(t('merge.diffDiscardConfirm'))) return
    onClose()
  }

  const save = async () => {
    const content = editorsRef.current.result?.getValue() ?? resultText
    if (parseConflictHunks(content).length > 0) {
      if (!window.confirm(t('merge.diffStillMarkers'))) {
        return
      }
    }
    setBusy(true)
    setError(null)
    try {
      await invoke('git_merge_resolve_content', {
        path: projectPath,
        file,
        content,
      })
      setDirty(false)
      await onSaved()
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title={t('merge.diffTitle', { file })}
      onClose={tryClose}
      wide
      elevated
      className="merge-editor-modal"
      closeOnEsc={!busy}
      footer={
        <div className="modal-actions">
          {binary ? (
            <button type="button" className="btn" onClick={onClose}>
              {t('branch.cancel')}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={tryClose}
              >
                {t('branch.cancel')}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? t('merge.saving') : t('merge.saveResolved')}
              </button>
            </>
          )}
        </div>
      }
    >
      {error && <div className="status-banner dirty">{error}</div>}
      {loading && <div className="muted">{t('merge.loading')}</div>}
      {binary && (
        <div className="muted">{t('merge.binaryHint')}</div>
      )}
      {!loading && !binary && (
        <>
          <div className="merge-editor-toolbar">
            <span className="merge-editor-status muted">
              {hunkCount > 0
                ? t('merge.hunkProgress', { current: currentHunk + 1, total: hunkCount })
                : t('merge.noConflicts')}
            </span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || hunkCount === 0 || currentHunk <= 0}
              onClick={prevConflict}
              title={t('merge.prevConflict')}
            >
              ↑ {t('merge.prevConflict')}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || hunkCount === 0 || currentHunk >= hunkCount - 1}
              onClick={nextConflict}
              title={t('merge.nextConflict')}
            >
              {t('merge.nextConflict')} ↓
            </button>
            <span className="merge-editor-toolbar-sep" />
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || hunkCount === 0}
              onClick={() => applyChoice('ours')}
              title={t('merge.hunkOurs')}
            >
              ← {t('merge.hunkOurs')}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || hunkCount === 0}
              onClick={() => applyChoice('theirs')}
              title={t('merge.hunkTheirs')}
            >
              {t('merge.hunkTheirs')} →
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy || hunkCount === 0}
              onClick={() => applyChoice('both')}
              title={t('merge.hunkBoth')}
            >
              {t('merge.hunkBoth')}
            </button>
          </div>

          <div className="merge-editor-panes">
            {/* Ours pane */}
            <div className="merge-editor-pane">
              <div className="merge-editor-pane-header">
                <span className="merge-editor-pane-title">
                  {t('merge.paneOurs')}
                </span>
                <div className="merge-editor-pane-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={acceptAllOurs}
                    title={t('diff.acceptLeft')}
                  >
                    {t('diff.acceptLeft')} →
                  </button>
                </div>
              </div>
              <div className="merge-editor-pane-body" ref={oursRef} />
            </div>

            {/* Result pane (editable) */}
            <div className="merge-editor-pane merge-editor-pane-result">
              <div className="merge-editor-pane-header">
                <span className="merge-editor-pane-title">
                  {t('merge.paneResult')}
                </span>
              </div>
              <div className="merge-editor-pane-body" ref={resultRef} />
            </div>

            {/* Theirs pane */}
            <div className="merge-editor-pane">
              <div className="merge-editor-pane-header">
                <span className="merge-editor-pane-title">
                  {t('merge.paneTheirs')}
                </span>
                <div className="merge-editor-pane-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={acceptAllTheirs}
                    title={t('diff.acceptRight')}
                  >
                    ← {t('diff.acceptRight')}
                  </button>
                </div>
              </div>
              <div className="merge-editor-pane-body" ref={theirsRef} />
            </div>
          </div>
        </>
      )}
    </ModalShell>
  )
}
