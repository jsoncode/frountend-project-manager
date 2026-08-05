import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { useI18n } from '../i18n/useI18n'
import { languageFromPath } from '../lib/editorLanguage'
import {
  applyNthHunkChoice,
  looksBinary,
  parseConflictHunks,
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
    lineHeight: 20,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    renderLineHighlight: readOnly ? 'none' : 'line',
    theme,
  })
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

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [binary, setBinary] = useState(false)
  const [resultText, setResultText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [hunkCount, setHunkCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const initialRef = useRef('')

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
        setHunkCount(parseConflictHunks(sides.working).length)
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
              setHunkCount(parseConflictHunks(v).length)
            })
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
    const ed = editorsRef.current.result
    if (!ed) return
    const next = applyNthHunkChoice(ed.getValue(), 0, choice)
    ed.setValue(next)
  }, [])

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
              {t('merge.hunkRemaining', { n: hunkCount })}
            </span>
            <div style={{ flex: 1 }} />
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
            <div className="merge-editor-pane">
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
