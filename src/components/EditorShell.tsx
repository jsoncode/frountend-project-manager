import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { readTextFile, writeTextFile } from '../lib/editorFs'
import {
  editorPathKey,
  useEditorStore,
} from '../stores/editorStore'
import { useExplorerStore } from '../stores/explorerStore'
import { useProjectStore } from '../stores/projectStore'
import { MonacoEditor } from './MonacoEditor'

export function EditorShell() {
  const selection = useExplorerStore((s) => s.selection)
  const setSelection = useExplorerStore((s) => s.setSelection)
  const selectedProject = useProjectStore((s) => s.selected)
  const refreshGitStatus = useProjectStore((s) => s.refreshGitStatus)

  const tabs = useEditorStore((s) => s.tabs)
  const activePath = useEditorStore((s) => s.activePath)
  const docs = useEditorStore((s) => s.docs)
  const openTab = useEditorStore((s) => s.openTab)
  const setDocLoading = useEditorStore((s) => s.setDocLoading)
  const setDocReady = useEditorStore((s) => s.setDocReady)
  const setDocError = useEditorStore((s) => s.setDocError)
  const setDocValue = useEditorStore((s) => s.setDocValue)
  const markDocSaved = useEditorStore((s) => s.markDocSaved)
  const getDoc = useEditorStore((s) => s.getDoc)

  const { t } = useI18n()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const loadingRef = useRef(new Set<string>())

  const activeTab =
    activePath == null
      ? null
      : tabs.find((t) => editorPathKey(t.path) === editorPathKey(activePath)) ??
        null
  const activeDoc = activePath ? docs[editorPathKey(activePath)] : undefined

  // Explorer / selection → open (or focus) a tab without closing others.
  useEffect(() => {
    if (selection?.kind !== 'file') return
    openTab(selection.path, selection.projectPath)
  }, [selection, openTab])

  // Load document content when a tab becomes active and has no ready/error doc.
  useEffect(() => {
    if (!activeTab) return
    const key = editorPathKey(activeTab.path)
    const existing = getDoc(activeTab.path)
    if (existing && (existing.status === 'ready' || existing.status === 'error')) {
      return
    }
    if (loadingRef.current.has(key)) return
    loadingRef.current.add(key)
    setDocLoading(activeTab.path)
    setSaveError(null)

    let cancelled = false
    void readTextFile(activeTab.path)
      .then((result) => {
        if (cancelled) return
        const content = result.content
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
        setDocReady(activeTab.path, content)
      })
      .catch((e) => {
        if (cancelled) return
        setDocError(
          activeTab.path,
          e instanceof Error ? e.message : String(e),
        )
      })
      .finally(() => {
        loadingRef.current.delete(key)
      })

    return () => {
      cancelled = true
    }
  }, [activeTab, getDoc, setDocLoading, setDocReady, setDocError])

  const save = useCallback(async () => {
    if (!activeTab || !activeDoc || activeDoc.status !== 'ready' || saving) {
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await writeTextFile(activeTab.path, activeDoc.value)
      markDocSaved(activeTab.path)
      void refreshGitStatus()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [activeTab, activeDoc, saving, markDocSaved, refreshGitStatus])

  const openImportTarget = useCallback(
    (absPath: string) => {
      if (!activeTab) return
      // Open in a new tab (or focus existing) — never close the current one.
      openTab(absPath, activeTab.projectPath)
      setSelection({
        kind: 'file',
        path: absPath,
        projectPath: activeTab.projectPath,
      })
    },
    [activeTab, openTab, setSelection],
  )

  const retryLoad = useCallback(() => {
    if (!activeTab) return
    loadingRef.current.delete(editorPathKey(activeTab.path))
    setDocLoading(activeTab.path)
    void readTextFile(activeTab.path)
      .then((result) => {
        const content = result.content
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
        setDocReady(activeTab.path, content)
      })
      .catch((e) => {
        setDocError(
          activeTab.path,
          e instanceof Error ? e.message : String(e),
        )
      })
  }, [activeTab, setDocLoading, setDocReady, setDocError])

  // No active tab → show placeholder (editor not mounted).
  if (!activeTab) {
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

  // Error state (and no previous editor to show) → inline error.
  const showError = activeDoc?.status === 'error'

  return (
    <div className="editor-shell">
      {saveError ? (
        <div className="editor-save-error">{saveError}</div>
      ) : null}
      <div className="editor-monaco-wrap">
        <MonacoEditor
          path={activeTab.path}
          projectPath={activeTab.projectPath}
          value={activeDoc?.status === 'ready' ? activeDoc.value : ''}
          onChange={(value) => setDocValue(activeTab.path, value)}
          onSave={() => void save()}
          onOpenFile={openImportTarget}
        />
        {/* Loading overlay — keeps editor mounted underneath */}
        {(!activeDoc || activeDoc.status === 'loading') && (
          <div className="editor-shell-overlay">
            <span className="muted">{t('editor.loading')}</span>
          </div>
        )}
        {showError && (
          <div className="editor-shell-overlay">
            <div className="editor-shell-placeholder">
              <div className="editor-error">{t('editor.openFailed')}</div>
              <div className="muted" style={{ marginTop: 8 }}>
                {activeDoc.error}
              </div>
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginTop: 12 }}
                onClick={retryLoad}
              >
                {t('editor.retry')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
