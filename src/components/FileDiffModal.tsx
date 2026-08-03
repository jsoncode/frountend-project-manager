import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { useI18n } from '../i18n/useI18n'
import { languageFromPath } from '../lib/editorLanguage'
import { setupMonacoEnvironment } from '../lib/monacoEnv'
import { ModalShell } from './ModalShell'
import { toProjectRelative } from '../lib/gitDecorations'

type Props = {
  projectPath: string
  /** Absolute path of the file to diff */
  filePath: string
  onClose: () => void
}

const FONT = "Consolas, 'Courier New', ui-monospace, monospace"

export function FileDiffModal({ projectPath, filePath, onClose }: Props) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')

  useEffect(() => {
    let disposed = false

    async function load() {
      try {
        const rel = toProjectRelative(filePath, projectPath)
        if (!rel) throw new Error('文件不在项目范围内')
        const name = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel
        setFileName(name)

        const result = await invoke<{ head: string; working: string }>(
          'git_diff_head',
          { path: projectPath, file: rel },
        )

        if (disposed) return

        const lang = languageFromPath(filePath)
        const container = containerRef.current
        if (!container) return

        setupMonacoEnvironment()
        const originalModel = monaco.editor.createModel(result.head, lang)
        const modifiedModel = monaco.editor.createModel(result.working, lang)

        const editor = monaco.editor.createDiffEditor(container, {
          automaticLayout: true,
          fontFamily: FONT,
          fontSize: 13,
          lineHeight: 20,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          renderSideBySide: true,
          readOnly: true,
          theme: 'vs-dark',
        })

        editor.setModel({ original: originalModel, modified: modifiedModel })
        editorRef.current = editor
        setLoading(false)
      } catch (e) {
        if (!disposed) setError(String(e))
        setLoading(false)
      }
    }

    void load()

    return () => {
      disposed = true
      editorRef.current?.dispose()
      editorRef.current = null
    }
  }, [projectPath, filePath])

  return (
    <ModalShell
      title={`${t('explorer.viewChanges')} — ${fileName}`}
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
        }}
      >
        {loading && (
          <div className="modal-loading">{t('merge.loading')}</div>
        )}
        {error && (
          <div className="modal-error">{error}</div>
        )}
        <div
          ref={containerRef}
          style={{
            position: 'absolute',
            inset: 0,
            display: loading || error ? 'none' : 'block',
          }}
        />
      </div>
    </ModalShell>
  )
}
