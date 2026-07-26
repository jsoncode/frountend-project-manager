import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { readTextFile, writeTextFile } from '../lib/editorFs'
import { useEditorStore } from '../stores/editorStore'
import { useExplorerStore } from '../stores/explorerStore'
import { useProjectStore } from '../stores/projectStore'
import { MonacoEditor } from './MonacoEditor'

type LoadState =
  | { status: 'idle' }
  | { status: 'loading'; path: string }
  | {
      status: 'ready'
      path: string
      projectPath: string
      baseline: string
      value: string
    }
  | { status: 'error'; path: string; message: string }

export function EditorShell() {
  const selection = useExplorerStore((s) => s.selection)
  const setSelection = useExplorerStore((s) => s.setSelection)
  const selectedProject = useProjectStore((s) => s.selected)
  const refreshGitStatus = useProjectStore((s) => s.refreshGitStatus)
  const setDirtyPath = useEditorStore((s) => s.setDirtyPath)
  const { t } = useI18n()
  const [load, setLoad] = useState<LoadState>({ status: 'idle' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const dirtyRef = useRef(false)
  const loadRef = useRef(load)
  loadRef.current = load

  const filePath = selection?.kind === 'file' ? selection.path : null
  const projectPath =
    selection?.kind === 'file' ? selection.projectPath : ''

  const dirty =
    load.status === 'ready' && load.value !== load.baseline
  dirtyRef.current = dirty

  // Use explorer selection path so the header asterisk always matches.
  useEffect(() => {
    if (filePath && load.status === 'ready' && dirty) {
      setDirtyPath(filePath)
    } else {
      setDirtyPath(null)
    }
  }, [filePath, load, dirty, setDirtyPath])

  useEffect(() => {
    return () => setDirtyPath(null)
  }, [setDirtyPath])

  const openFile = useCallback(async (path: string, projPath: string) => {
    setSaveError(null)
    setLoad({ status: 'loading', path })
    try {
      const result = await readTextFile(path)
      // Monaco uses LF; normalize so dirty checks / cursor stay consistent.
      const content = result.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      setLoad({
        status: 'ready',
        path,
        projectPath: projPath,
        baseline: content,
        value: content,
      })
    } catch (e) {
      setLoad({
        status: 'error',
        path,
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }, [])

  useEffect(() => {
    if (!filePath) {
      setLoad({ status: 'idle' })
      setSaveError(null)
      return
    }

    const current = loadRef.current
    if (
      (current.status === 'ready' || current.status === 'loading') &&
      current.path === filePath
    ) {
      return
    }

    if (dirtyRef.current && current.status === 'ready') {
      const ok = window.confirm(t('editor.unsavedConfirm'))
      if (!ok) {
        setSelection({
          kind: 'file',
          path: current.path,
          projectPath: current.projectPath,
        })
        return
      }
    }

    void openFile(filePath, projectPath)
  }, [filePath, projectPath, openFile, setSelection, t])

  const save = useCallback(async () => {
    if (load.status !== 'ready' || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await writeTextFile(load.path, load.value)
      setLoad({
        status: 'ready',
        path: load.path,
        projectPath: load.projectPath,
        baseline: load.value,
        value: load.value,
      })
      void refreshGitStatus()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [load, saving, refreshGitStatus])

  if (!filePath) {
    let hint = t('editor.shellEmpty')
    if (selection?.kind === 'dir') {
      const name = selection.path.split(/[/\\]/).pop() ?? selection.path
      hint = t('editor.shellFolder', { name })
    } else if (!selectedProject) {
      hint = t('app.selectProject')
    }
    return (
      <div className="editor-shell">
        <div className="editor-shell-body">
          <div className="editor-shell-placeholder muted">{hint}</div>
        </div>
      </div>
    )
  }

  if (load.status === 'loading' || load.status === 'idle') {
    return (
      <div className="editor-shell">
        <div className="editor-shell-body">
          <div className="editor-shell-placeholder muted">
            {t('editor.loading')}
          </div>
        </div>
      </div>
    )
  }

  if (load.status === 'error') {
    return (
      <div className="editor-shell">
        <div className="editor-shell-body">
          <div className="editor-shell-placeholder">
            <div className="editor-error">{t('editor.openFailed')}</div>
            <div className="muted" style={{ marginTop: 8 }}>
              {load.message}
            </div>
            <button
              type="button"
              className="btn btn-sm"
              style={{ marginTop: 12 }}
              onClick={() => void openFile(filePath, projectPath)}
            >
              {t('editor.retry')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="editor-shell">
      {saveError ? (
        <div className="editor-save-error">{saveError}</div>
      ) : null}
      <div className="editor-monaco-wrap">
        <MonacoEditor
          path={load.path}
          value={load.value}
          onChange={(value) =>
            setLoad((prev) =>
              prev.status === 'ready' ? { ...prev, value } : prev,
            )
          }
          onSave={() => void save()}
        />
      </div>
    </div>
  )
}
