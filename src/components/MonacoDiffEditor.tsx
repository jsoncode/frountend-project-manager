import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import { languageFromPath } from '../lib/editorLanguage'
import { setupMonacoEnvironment } from '../lib/monacoEnv'
import { registerEditorThemes } from '../lib/monacoThemes'
import { useSettingsStore } from '../stores/settingsStore'

type Props = {
  original: string
  modified: string
  language?: string
  filePath?: string
  readOnly?: boolean
  /** Called when modified content changes (only when readOnly=false) */
  onChange?: (value: string) => void
  /** Called when diff editor is ready */
  onReady?: (editor: monaco.editor.IStandaloneDiffEditor) => void
}

const FONT = "Consolas, 'Courier New', ui-monospace, monospace"

/**
 * Reusable Monaco diff editor component.
 * Supports side-by-side diff with optional editing on the modified side.
 */
export function MonacoDiffEditor({
  original,
  modified,
  language,
  filePath,
  readOnly = true,
  onChange,
  onReady,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const editorTheme = useSettingsStore((s) => s.config?.editorTheme ?? 'vs-dark')

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    setupMonacoEnvironment()
    registerEditorThemes(monaco)

    const lang = language ?? (filePath ? languageFromPath(filePath) : 'plaintext')
    const originalModel = monaco.editor.createModel(
      original.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
      lang,
    )
    const modifiedModel = monaco.editor.createModel(
      modified.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
      lang,
    )

    const editor = monaco.editor.createDiffEditor(el, {
      automaticLayout: true,
      fontFamily: FONT,
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderSideBySide: true,
      readOnly,
      theme: editorTheme,
      originalEditable: false,
      renderIndicators: true,
      renderMarginRevertIcon: false,
      diffCodeLens: false,
    })

    editor.setModel({ original: originalModel, modified: modifiedModel })
    editorRef.current = editor

    if (!readOnly) {
      const modifiedEditor = editor.getModifiedEditor()
      modifiedEditor.onDidChangeModelContent(() => {
        onChangeRef.current?.(modifiedEditor.getValue())
      })
    }

    // Notify ready after a frame so layout is settled
    requestAnimationFrame(() => {
      onReadyRef.current?.(editor)
    })

    return () => {
      editor.dispose()
      originalModel.dispose()
      modifiedModel.dispose()
      editorRef.current = null
    }
    // Only create once - content updates handled via model
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update content when props change
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const models = editor.getModel()
    if (!models) return

    const origText = original.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const modText = modified.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    if (models.original.getValue() !== origText) {
      models.original.setValue(origText)
    }
    if (models.modified.getValue() !== modText) {
      models.modified.setValue(modText)
    }
  }, [original, modified])

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    />
  )
}
