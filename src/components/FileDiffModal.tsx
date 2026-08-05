import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { useI18n } from '../i18n/useI18n'
import { MonacoDiffEditor } from './MonacoDiffEditor'
import { ModalShell } from './ModalShell'
import { toProjectRelative } from '../lib/gitDecorations'

type Props = {
  projectPath: string
  /** Absolute path of the file to diff */
  filePath: string
  /** If provided, compare two files directly instead of HEAD vs working */
  compareFilePath?: string
  onClose: () => void
}

export function FileDiffModal({ projectPath, filePath, compareFilePath, onClose }: Props) {
  const { t } = useI18n()
  const isCompareMode = Boolean(compareFilePath)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [headContent, setHeadContent] = useState('')
  const [workingContent, setWorkingContent] = useState('')
  const [currentChange, setCurrentChange] = useState(0)
  const [totalChanges, setTotalChanges] = useState(0)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)

  useEffect(() => {
    let disposed = false

    async function load() {
      try {
        if (isCompareMode && compareFilePath) {
          // Compare two files directly
          const rel1 = toProjectRelative(filePath, projectPath) ?? filePath
          const rel2 = toProjectRelative(compareFilePath, projectPath) ?? compareFilePath
          const name1 = rel1.includes('/') ? rel1.slice(rel1.lastIndexOf('/') + 1) : rel1
          const name2 = rel2.includes('/') ? rel2.slice(rel2.lastIndexOf('/') + 1) : rel2
          setFileName(`${name1} ↔ ${name2}`)

          const [r1, r2] = await Promise.all([
            invoke<{ content: string }>('read_text_file', { path: filePath }),
            invoke<{ content: string }>('read_text_file', { path: compareFilePath }),
          ])

          if (disposed) return
          setHeadContent(r1.content)
          setWorkingContent(r2.content)
          setLoading(false)
        } else {
          // Original: HEAD vs working
          const rel = toProjectRelative(filePath, projectPath)
          if (!rel) throw new Error('文件不在项目范围内')
          const name = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel
          setFileName(name)

          const result = await invoke<{ head: string; working: string }>(
            'git_diff_head',
            { path: projectPath, file: rel },
          )

          if (disposed) return
          setHeadContent(result.head)
          setWorkingContent(result.working)
          setLoading(false)
        }
      } catch (e) {
        if (!disposed) setError(String(e))
        setLoading(false)
      }
    }

    void load()

    return () => {
      disposed = true
    }
  }, [projectPath, filePath, compareFilePath, isCompareMode])

  const handleReady = useCallback((editor: monaco.editor.IStandaloneDiffEditor) => {
    editorRef.current = editor

    // Count changes
    const diffComputation = editor.getLineChanges()
    if (diffComputation) {
      setTotalChanges(diffComputation.length)
    }

    // Update change count on content change
    const modifiedEditor = editor.getModifiedEditor()
    modifiedEditor.onDidChangeModelContent(() => {
      const changes = editor.getLineChanges()
      if (changes) {
        setTotalChanges(changes.length)
      }
    })
  }, [])

  const goToChange = useCallback((index: number) => {
    const editor = editorRef.current
    if (!editor) return

    const changes = editor.getLineChanges()
    if (!changes || index < 0 || index >= changes.length) return

    const change = changes[index]
    const modifiedRange = change.modifiedStartLineNumber

    const modifiedEditor = editor.getModifiedEditor()
    modifiedEditor.revealLineInCenter(modifiedRange)
    modifiedEditor.setPosition({
      lineNumber: modifiedRange,
      column: 1,
    })
    modifiedEditor.focus()

    setCurrentChange(index)
  }, [])

  const goToNextChange = useCallback(() => {
    if (currentChange < totalChanges - 1) {
      goToChange(currentChange + 1)
    } else if (totalChanges > 0) {
      goToChange(0)
    }
  }, [currentChange, totalChanges, goToChange])

  const goToPrevChange = useCallback(() => {
    if (currentChange > 0) {
      goToChange(currentChange - 1)
    } else if (totalChanges > 0) {
      goToChange(totalChanges - 1)
    }
  }, [currentChange, totalChanges, goToChange])

  return (
    <ModalShell
      title={`${isCompareMode ? t('explorer.compareWith') : t('explorer.viewChanges')} — ${fileName}`}
      onClose={onClose}
      wide
      className="file-diff-modal"
    >
      <div
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {loading && (
          <div className="modal-loading">{t('merge.loading')}</div>
        )}
        {error && (
          <div className="modal-error">{error}</div>
        )}

        {/* Navigation toolbar */}
        {!loading && !error && (
          <div className="diff-toolbar">
            <button
              type="button"
              className="btn btn-sm"
              onClick={goToPrevChange}
              disabled={totalChanges === 0}
              title={t('diff.prevChange')}
            >
              ↑ {t('diff.prev')}
            </button>
            <span className="diff-nav-info muted">
              {totalChanges > 0
                ? t('diff.changeCount', {
                    current: currentChange + 1,
                    total: totalChanges,
                  })
                : t('diff.noChanges')}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={goToNextChange}
              disabled={totalChanges === 0}
              title={t('diff.nextChange')}
            >
              {t('diff.next')} ↓
            </button>
          </div>
        )}

        {/* Diff editor */}
        {!loading && !error && (
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            <MonacoDiffEditor
              original={headContent}
              modified={workingContent}
              filePath={filePath}
              readOnly={false}
              onReady={handleReady}
            />
          </div>
        )}
      </div>
    </ModalShell>
  )
}
