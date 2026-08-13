import { invoke } from '@tauri-apps/api/core'
import { Button } from 'antd'
import { useEffect, useRef, useState } from 'react'
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

function createPane(
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

export function MergeDiffModal({ projectPath, file, onClose, onSaved }: Props) {
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

        // Create editors after DOM paints.
        requestAnimationFrame(() => {
          if (cancelled) return
          registerEditorThemes(monaco)
          if (oursRef.current && !editorsRef.current.ours) {
            editorsRef.current.ours = createPane(
              oursRef.current,
              sides.ours,
              lang,
              true,
              editorTheme,
            )
          }
          if (theirsRef.current && !editorsRef.current.theirs) {
            editorsRef.current.theirs = createPane(
              theirsRef.current,
              sides.theirs,
              lang,
              true,
              editorTheme,
            )
          }
          if (resultRef.current && !editorsRef.current.result) {
            const ed = createPane(
              resultRef.current,
              sides.working,
              lang,
              false,
              editorTheme,
            )
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

  const applyChoice = (choice: 'ours' | 'theirs' | 'both') => {
    const ed = editorsRef.current.result
    if (!ed) return
    const next = applyNthHunkChoice(ed.getValue(), 0, choice)
    ed.setValue(next)
  }

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
      className="merge-diff-modal"
      closeOnEsc={!busy}
      footer={
        <>
          {binary ? (
            <Button onClick={onClose}>
              {t('branch.cancel')}
            </Button>
          ) : (
            <>
              <Button disabled={busy} onClick={tryClose}>
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
          <div className="merge-diff-toolbar">
            <span className="muted">
              {t('merge.hunkRemaining', { n: hunkCount })}
            </span>
            <Button
              size="small"
              disabled={busy || hunkCount === 0}
              onClick={() => applyChoice('ours')}
            >
              {t('merge.hunkOurs')}
            </Button>
            <Button
              size="small"
              disabled={busy || hunkCount === 0}
              onClick={() => applyChoice('theirs')}
            >
              {t('merge.hunkTheirs')}
            </Button>
            <Button
              size="small"
              disabled={busy || hunkCount === 0}
              onClick={() => applyChoice('both')}
            >
              {t('merge.hunkBoth')}
            </Button>
          </div>
          <div className="merge-diff-panes">
            <div className="merge-diff-pane">
              <div className="merge-diff-label">{t('merge.paneOurs')}</div>
              <div className="merge-diff-editor" ref={oursRef} />
            </div>
            <div className="merge-diff-pane">
              <div className="merge-diff-label">{t('merge.paneTheirs')}</div>
              <div className="merge-diff-editor" ref={theirsRef} />
            </div>
            <div className="merge-diff-pane">
              <div className="merge-diff-label">{t('merge.paneResult')}</div>
              <div className="merge-diff-editor" ref={resultRef} />
            </div>
          </div>
        </>
      )}
    </ModalShell>
  )
}
