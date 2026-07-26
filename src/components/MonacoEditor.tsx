import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import { languageFromPath } from '../lib/editorLanguage'
import { setupMonacoEnvironment } from '../lib/monacoEnv'

type Props = {
  path: string
  /** Initial / external document text. Not pushed back on every keystroke. */
  value: string
  onChange: (value: string) => void
  onSave?: () => void
}

/** System mono only — web fonts cause cursor/glyph width mismatch in WebView2. */
const EDITOR_FONT =
  "Consolas, 'Courier New', ui-monospace, monospace"

function normalizeEol(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function remasureWhenFontsReady(editor: monaco.editor.IStandaloneCodeEditor) {
  const run = () => {
    monaco.editor.remeasureFonts()
    editor.layout()
  }
  run()
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    void document.fonts.ready.then(run)
  }
  // WebView2 sometimes finishes font swap a tick later.
  window.setTimeout(run, 50)
  window.setTimeout(run, 250)
}

/**
 * Thin Monaco host. Model is keyed by path. Parent state mirrors edits via
 * onChange, but we do NOT write parent `value` back into the model on each
 * keystroke (that restores a stale cursor and looks one character behind).
 */
export function MonacoEditor({ path, value, onChange, onSave }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const pathRef = useRef(path)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  pathRef.current = path
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    setupMonacoEnvironment()

    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    })
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      allowNonTsExtensions: true,
      allowJs: true,
      checkJs: false,
      moduleResolution:
        monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      lib: ['esnext', 'dom'],
    })
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      allowNonTsExtensions: true,
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      moduleResolution:
        monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      lib: ['esnext', 'dom'],
    })

    const language = languageFromPath(path)
    const text = normalizeEol(value)
    const uri = monaco.Uri.parse(`file:///${path.replace(/\\/g, '/')}`)
    let model = monaco.editor.getModel(uri)
    if (!model) {
      model = monaco.editor.createModel(text, language, uri)
    } else {
      monaco.editor.setModelLanguage(model, language)
      if (model.getValue() !== text) {
        model.setValue(text)
      }
    }

    const editor = monaco.editor.create(el, {
      model,
      automaticLayout: true,
      theme: 'vs-dark',
      fontSize: 13,
      fontFamily: EDITOR_FONT,
      fontLigatures: false,
      letterSpacing: 0,
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      padding: { top: 8, bottom: 8 },
      tabSize: 2,
      wordWrap: 'on',
      smoothScrolling: true,
      cursorBlinking: 'solid',
      cursorSmoothCaretAnimation: 'off',
      bracketPairColorization: { enabled: true },
      quickSuggestions: {
        other: true,
        comments: false,
        strings: true,
      },
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: 'on',
      snippetSuggestions: 'inline',
    })
    editorRef.current = editor
    remasureWhenFontsReady(editor)

    const sub = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue())
    })

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.()
    })

    const onWinResize = () => remasureWhenFontsReady(editor)
    window.addEventListener('resize', onWinResize)

    return () => {
      window.removeEventListener('resize', onWinResize)
      sub.dispose()
      editor.dispose()
      editorRef.current = null
    }
    // Intentionally only depend on path: `value` is applied when opening a file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  useEffect(() => {
    return () => {
      const uri = monaco.Uri.parse(
        `file:///${pathRef.current.replace(/\\/g, '/')}`,
      )
      monaco.editor.getModel(uri)?.dispose()
    }
  }, [])

  return <div className="monaco-host" ref={containerRef} />
}
