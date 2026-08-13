import { invoke } from '@tauri-apps/api/core'
import { Button } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { useI18n } from '../i18n/useI18n'
import { computeLineDiff, splitLines } from '../lib/diffUtils'
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

/** Ours lines that differ from the common ancestor. */
const OURS_CHANGED_DECORATION = {
  isWholeLine: true,
  className: 'merge-side-ours-line',
  linesDecorationsClassName: 'merge-side-ours-gutter',
}

/** Theirs lines that differ from the common ancestor. */
const THEIRS_CHANGED_DECORATION = {
  isWholeLine: true,
  className: 'merge-side-theirs-line',
  linesDecorationsClassName: 'merge-side-theirs-gutter',
}

/** Result pane: ours-side line that differs from the theirs side. */
const DIFF_OURS_LINE_DECORATION = {
  isWholeLine: true,
  className: 'merge-diff-ours-line',
}

/** Result pane: theirs-side line that differs from the ours side. */
const DIFF_THEIRS_LINE_DECORATION = {
  isWholeLine: true,
  className: 'merge-diff-theirs-line',
}

/** Stronger outline for the conflict currently being resolved. */
const CURRENT_CONFLICT_DECORATION = {
  isWholeLine: true,
  className: 'merge-conflict-current',
}

/** Stronger emphasis for the active conflict block in the ours pane. */
const OURS_CURRENT_DECORATION = {
  isWholeLine: true,
  className: 'merge-side-ours-current',
  linesDecorationsClassName: 'merge-side-ours-gutter',
}

/** Stronger emphasis for the active conflict block in the theirs pane. */
const THEIRS_CURRENT_DECORATION = {
  isWholeLine: true,
  className: 'merge-side-theirs-current',
  linesDecorationsClassName: 'merge-side-theirs-gutter',
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

/** Normalize block text so trailing-newline variants compare equal. */
function normBlock(s: string): string {
  return s.replace(/\r?\n$/, '')
}

/**
 * Line ranges (1-based, inclusive) in `side` that changed relative to `base`.
 * Used to highlight what each side actually modified (vs the common ancestor).
 */
function changedLineRanges(base: string, side: string): Array<{ start: number; end: number }> {
  const diff = computeLineDiff(splitLines(base), splitLines(side))
  const ranges: Array<{ start: number; end: number }> = []
  let cur: { start: number; end: number } | null = null
  for (const l of diff) {
    if (l.type === 'insert' && l.modifiedLineNo) {
      if (cur && cur.end === l.modifiedLineNo - 1) {
        cur.end = l.modifiedLineNo
      } else {
        if (cur) ranges.push(cur)
        cur = { start: l.modifiedLineNo, end: l.modifiedLineNo }
      }
    } else {
      if (cur) ranges.push(cur)
      cur = null
    }
  }
  if (cur) ranges.push(cur)
  return ranges
}

/**
 * Pair each working-file conflict hunk with the line range of the same block
 * in a side file (WebStorm-style per-block targeting). Order-anchored greedy
 * match on block content, falling back to a forward search.
 */
function matchSideRanges(
  base: string,
  side: string,
  hunks: ConflictHunk[],
  pick: (h: ConflictHunk) => string,
): Array<{ start: number; end: number } | null> {
  const regions = changedLineRanges(base, side)
  const sideLines = side.split('\n')
  const out: Array<{ start: number; end: number } | null> = []
  let cursor = 0
  for (const h of hunks) {
    const target = normBlock(pick(h))
    let found: { start: number; end: number } | null = null
    if (target.length > 0) {
      for (let i = cursor; i < regions.length; i++) {
        const r = regions[i]
        const text = normBlock(sideLines.slice(r.start - 1, r.end).join('\n'))
        if (text === target) {
          found = r
          cursor = i + 1
          break
        }
      }
      if (!found) {
        const targetLines = target.split('\n')
        outer: for (let s = 0; s + targetLines.length <= sideLines.length; s++) {
          for (let k = 0; k < targetLines.length; k++) {
            if (sideLines[s + k] !== targetLines[k]) continue outer
          }
          found = { start: s + 1, end: s + targetLines.length }
          break
        }
      }
    }
    out.push(found)
  }
  return out
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
  const oursDecoRef = useRef<string[]>([])
  const theirsDecoRef = useRef<string[]>([])
  const oursWidgetRef = useRef<monaco.editor.IContentWidget[]>([])
  const theirsWidgetRef = useRef<monaco.editor.IContentWidget[]>([])
  /** Loaded ours/theirs/base texts for side-pane block matching. */
  const sidesRef = useRef({ base: '', ours: '', theirs: '' })
  /** Mirror of currentHunk for use inside editor callbacks. */
  const currentHunkRef = useRef(0)

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
  const applyDecorations = useCallback((editor: monaco.editor.IStandaloneCodeEditor, text: string, hunkList: ConflictHunk[], activeIdx: number) => {
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

      // Emphasize the conflict currently being resolved.
      if (idx === activeIdx) {
        decorations.push({
          range: new monaco.Range(range.start, 1, range.end, model.getLineMaxColumn(range.end)),
          options: CURRENT_CONFLICT_DECORATION,
        })
      }

      // Line-level comparison inside the conflict (WebStorm-style): mark the
      // ours lines that differ from theirs and vice versa, so it is obvious
      // line by line where the two sides disagree.
      const oursNorm = hunk.ours.replace(/\r?\n$/, '')
      const theirsNorm = hunk.theirs.replace(/\r?\n$/, '')
      const oursLines = oursNorm.length > 0 ? oursNorm.split('\n') : []
      const theirsLines = theirsNorm.length > 0 ? theirsNorm.split('\n') : []
      const lineDiff = computeLineDiff(oursLines, theirsLines)
      const oursStart = range.start + 1 // first line after <<<<<<<
      const theirsStart = oursStart + oursLines.length + 1 // after =======
      for (const dl of lineDiff) {
        if (dl.type === 'delete' && dl.lineNo > 0) {
          const line = oursStart + dl.lineNo - 1
          if (line <= model.getLineCount()) {
            decorations.push({
              range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)),
              options: DIFF_OURS_LINE_DECORATION,
            })
          }
        } else if (dl.type === 'insert' && dl.modifiedLineNo) {
          const line = theirsStart + dl.modifiedLineNo - 1
          if (line <= model.getLineCount()) {
            decorations.push({
              range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)),
              options: DIFF_THEIRS_LINE_DECORATION,
            })
          }
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

  /** Apply a choice to a specific hunk index, then jump to the next one. */
  const applyHunkAt = useCallback((idx: number, choice: 'ours' | 'theirs' | 'both') => {
    const ed = editorsRef.current.result
    if (!ed) return
    const text = ed.getValue()
    const hunkList = parseConflictHunks(text)
    const hunk = hunkList[idx]
    if (!hunk) return
    const next = applyHunkChoice(text, hunk, choice)
    ed.setValue(next)
    // WebStorm-style flow: automatically move on to the next remaining conflict.
    const remaining = parseConflictHunks(next)
    if (remaining.length > 0) {
      const nextIdx = Math.min(idx, remaining.length - 1)
      currentHunkRef.current = nextIdx
      setCurrentHunk(nextIdx)
      const range = hunkLineRange(next, remaining[nextIdx])
      ed.revealLineInCenter(range.start)
      ed.setPosition({ lineNumber: range.start, column: 1 })
    }
    ed.focus()
  }, [])

  /**
   * Highlight each conflict's matching block in the ours/theirs panes and
   * float an "accept this block" button on the active one (per-block
   * targeting instead of whole-file diffing).
   */
  const applySideDecorations = useCallback((hunkList: ConflictHunk[], activeIdx: number) => {
    const { base, ours, theirs } = sidesRef.current

    const applyToSide = (
      ed: monaco.editor.IStandaloneCodeEditor | null,
      sideText: string,
      pick: (h: ConflictHunk) => string,
      choice: 'ours' | 'theirs',
      decoRef: { current: string[] },
      widgetRef: { current: monaco.editor.IContentWidget[] },
    ) => {
      if (!ed) return
      const model = ed.getModel()
      if (!model) return
      const matched = matchSideRanges(base, sideText, hunkList, pick)
      const decorations: monaco.editor.IModelDeltaDecoration[] = []
      matched.forEach((r, i) => {
        if (!r) return
        const active = i === activeIdx
        decorations.push({
          range: new monaco.Range(r.start, 1, r.end, model.getLineMaxColumn(r.end)),
          options: active
            ? (choice === 'ours' ? OURS_CURRENT_DECORATION : THEIRS_CURRENT_DECORATION)
            : (choice === 'ours' ? OURS_CHANGED_DECORATION : THEIRS_CHANGED_DECORATION),
        })
      })
      if (decoRef.current.length > 0) ed.deltaDecorations(decoRef.current, [])
      decoRef.current = ed.deltaDecorations([], decorations)

      for (const w of widgetRef.current) ed.removeContentWidget(w)
      widgetRef.current = []
      const r = matched[activeIdx]
      if (!r) return
      ed.revealLineInCenterIfOutsideViewport(r.start)
      const domNode = document.createElement('div')
      domNode.className = 'merge-side-widget'
      const btn = document.createElement('button')
      btn.className = `btn btn-xs merge-hunk-btn ${choice}`
      btn.textContent = choice === 'ours'
        ? `${t('merge.acceptBlock')} →`
        : `← ${t('merge.acceptBlock')}`
      btn.title = choice === 'ours' ? t('merge.hunkOurs') : t('merge.hunkTheirs')
      btn.addEventListener('click', () => applyHunkAt(activeIdx, choice))
      domNode.appendChild(btn)
      const widget: monaco.editor.IContentWidget = {
        getId: () => `merge-side-${choice}`,
        getDomNode: () => domNode,
        getPosition: () => ({
          position: { lineNumber: r.start, column: 1 },
          preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE],
        }),
      }
      ed.addContentWidget(widget)
      widgetRef.current = [widget]
    }

    applyToSide(editorsRef.current.ours, ours, (h) => h.ours, 'ours', oursDecoRef, oursWidgetRef)
    applyToSide(editorsRef.current.theirs, theirs, (h) => h.theirs, 'theirs', theirsDecoRef, theirsWidgetRef)
  }, [t, applyHunkAt])

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
    currentHunkRef.current = idx
    applyDecorations(ed, text, hunkList, idx)
    applySideDecorations(hunkList, idx)
  }, [applyDecorations, applySideDecorations])

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
        sidesRef.current = { base: sides.base, ours: sides.ours, theirs: sides.theirs }
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
              setCurrentHunk((prev) => {
                const next = Math.min(prev, Math.max(0, newHunks.length - 1))
                currentHunkRef.current = next
                return next
              })
              applyDecorations(ed, v, newHunks, currentHunkRef.current)
              applySideDecorations(newHunks, currentHunkRef.current)
            })

            // Track the active conflict by cursor position (WebStorm-style):
            // the conflict containing the caret becomes the current one.
            ed.onDidChangeCursorPosition((e) => {
              const v = ed.getValue()
              const list = parseConflictHunks(v)
              const line = e.position.lineNumber
              const idx = list.findIndex((h) => {
                const r = hunkLineRange(v, h)
                return line >= r.start && line <= r.end
              })
              if (idx >= 0 && idx !== currentHunkRef.current) {
                currentHunkRef.current = idx
                setCurrentHunk(idx)
                applyDecorations(ed, v, list, idx)
                applySideDecorations(list, idx)
              }
            })

            // Apply initial decorations
            applyDecorations(ed, sides.working, initialHunks, 0)
            applySideDecorations(initialHunks, 0)

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
        <>
          {binary ? (
            <Button onClick={onClose}>
              {t('branch.cancel')}
            </Button>
          ) : (
            <>
              <Button
                disabled={busy}
                onClick={tryClose}
              >
                {t('branch.cancel')}
              </Button>
              <Button
                type="primary"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? t('merge.saving') : t('merge.saveResolved')}
              </Button>
            </>
          )}
        </>
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
            <Button
              size="small"
              disabled={busy || hunkCount === 0 || currentHunk <= 0}
              onClick={prevConflict}
              title={t('merge.prevConflict')}
            >
              ↑ {t('merge.prevConflict')}
            </Button>
            <Button
              size="small"
              disabled={busy || hunkCount === 0 || currentHunk >= hunkCount - 1}
              onClick={nextConflict}
              title={t('merge.nextConflict')}
            >
              {t('merge.nextConflict')} ↓
            </Button>
            <span className="merge-editor-toolbar-sep" />
            <Button
              size="small"
              disabled={busy || hunkCount === 0}
              onClick={() => applyChoice('ours')}
              title={t('merge.hunkOurs')}
            >
              ← {t('merge.hunkOurs')}
            </Button>
            <Button
              size="small"
              disabled={busy || hunkCount === 0}
              onClick={() => applyChoice('theirs')}
              title={t('merge.hunkTheirs')}
            >
              {t('merge.hunkTheirs')} →
            </Button>
            <Button
              size="small"
              disabled={busy || hunkCount === 0}
              onClick={() => applyChoice('both')}
              title={t('merge.hunkBoth')}
            >
              {t('merge.hunkBoth')}
            </Button>
          </div>

          <div className="merge-editor-panes">
            {/* Ours pane */}
            <div className="merge-editor-pane">
              <div className="merge-editor-pane-header">
                <span className="merge-editor-pane-title">
                  {t('merge.paneOurs')}
                </span>
                <div className="merge-editor-pane-actions">
                  <Button
                    size="small"
                    onClick={acceptAllOurs}
                    title={t('diff.acceptLeft')}
                  >
                    {t('diff.acceptLeft')} →
                  </Button>
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
                  <Button
                    size="small"
                    onClick={acceptAllTheirs}
                    title={t('diff.acceptRight')}
                  >
                    ← {t('diff.acceptRight')}
                  </Button>
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
