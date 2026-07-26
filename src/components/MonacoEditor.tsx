import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import { languageFromPath } from '../lib/editorLanguage'
import { setupMonacoEnvironment } from '../lib/monacoEnv'
import {
  applyAliasCompilerPaths,
  attachImportClickHandler,
  ensureProjectAliases,
  preloadImportsForFile,
  setMonacoNavContext,
  setupMonacoModuleNavigation,
} from '../lib/monacoNavigation'
import { closeActiveEditorFile } from '../lib/closeEditorFile'
import type { PathAlias } from '../lib/pathAliases'
import { useI18n } from '../i18n/useI18n'

type Props = {
  path: string
  projectPath: string
  /** Initial / external document text. Not pushed back on every keystroke. */
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  /** Open another project file (e.g. Ctrl+click import). */
  onOpenFile?: (absPath: string) => void
}

/** System mono only — web fonts cause cursor/glyph width mismatch in WebView2. */
const EDITOR_FONT =
  "Consolas, 'Courier New', ui-monospace, monospace"

/** Show source-preview minimap when the editor pane is at least this wide. */
const MINIMAP_WIDTH_PX = 1000

function minimapOptions(enabled: boolean): monaco.editor.IEditorMinimapOptions {
  return {
    enabled,
    side: 'right',
    size: 'proportional',
    showSlider: 'mouseover',
    renderCharacters: true,
    maxColumn: 120,
    scale: 1,
  }
}

function syncMinimapForWidth(
  editor: monaco.editor.IStandaloneCodeEditor,
  width: number,
) {
  const enabled = width >= MINIMAP_WIDTH_PX
  const current = editor.getOption(monaco.editor.EditorOption.minimap).enabled
  if (current === enabled) return
  editor.updateOptions({ minimap: minimapOptions(enabled) })
}

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
  window.setTimeout(run, 50)
  window.setTimeout(run, 250)
}

/**
 * Thin Monaco host. Model is keyed by path. Parent state mirrors edits via
 * onChange, but we do NOT write parent `value` back into the model on each
 * keystroke (that restores a stale cursor and looks one character behind).
 */
export function MonacoEditor({
  path,
  projectPath,
  value,
  onChange,
  onSave,
  onOpenFile,
}: Props) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const pathRef = useRef(path)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onOpenFileRef = useRef(onOpenFile)
  const aliasesRef = useRef<PathAlias[]>([])
  const preloadTimer = useRef<number | null>(null)
  const tRef = useRef(t)
  pathRef.current = path
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onOpenFileRef.current = onOpenFile
  tRef.current = t

  const schedulePreload = (fromFile: string, source: string) => {
    if (preloadTimer.current != null) {
      window.clearTimeout(preloadTimer.current)
    }
    preloadTimer.current = window.setTimeout(() => {
      const aliases = aliasesRef.current
      if (!aliases.length && !projectPath) return
      void preloadImportsForFile(
        monaco,
        projectPath,
        fromFile,
        source,
        aliases,
      )
    }, 120)
  }

  // Keep nav context + compiler paths fresh; then preload imports for open file.
  useEffect(() => {
    let cancelled = false
    void ensureProjectAliases(projectPath).then((aliases) => {
      if (cancelled) return
      aliasesRef.current = aliases
      applyAliasCompilerPaths(monaco, projectPath, aliases)
      setMonacoNavContext(projectPath, aliases, (abs) => {
        onOpenFileRef.current?.(abs)
      })
      const ed = editorRef.current
      const model = ed?.getModel()
      if (model) {
        schedulePreload(pathRef.current, model.getValue())
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath])

  useEffect(() => {
    setMonacoNavContext(projectPath, aliasesRef.current, (abs) => {
      onOpenFileRef.current?.(abs)
    })
  }, [projectPath, onOpenFile])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    setupMonacoEnvironment()
    setupMonacoModuleNavigation(monaco)

    const language = languageFromPath(path)
    const text = normalizeEol(value)
    const uri = monaco.Uri.file(path)
    let model = monaco.editor.getModel(uri)
    if (!model) {
      model = monaco.editor.createModel(text, language, uri)
    } else {
      monaco.editor.setModelLanguage(model, language)
      if (model.getValue() !== text) {
        model.setValue(text)
      }
    }

    const initialWide = el.clientWidth >= MINIMAP_WIDTH_PX
    const editor = monaco.editor.create(el, {
      model,
      automaticLayout: true,
      theme: 'vs-dark',
      fontSize: 13,
      fontFamily: EDITOR_FONT,
      fontLigatures: false,
      letterSpacing: 0,
      lineHeight: 20,
      minimap: minimapOptions(initialWide),
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      padding: { top: 8, bottom: 8 },
      tabSize: 2,
      wordWrap: 'on',
      smoothScrolling: true,
      cursorBlinking: 'solid',
      cursorSmoothCaretAnimation: 'off',
      bracketPairColorization: { enabled: true },
      links: true,
      definitionLinkOpensInPeek: false,
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
    syncMinimapForWidth(editor, el.clientWidth)

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth
      syncMinimapForWidth(editor, width)
    })
    resizeObserver.observe(el)

    // Resolve imports ASAP so sibling modules (./AiTopBar.tsx) sync into the
    // TS worker before / as diagnostics refresh.
    void preloadImportsForFile(
      monaco,
      projectPath,
      path,
      text,
      aliasesRef.current,
    )
    schedulePreload(path, text)

    const sub = editor.onDidChangeModelContent(() => {
      const next = editor.getValue()
      onChangeRef.current(next)
      schedulePreload(pathRef.current, next)
    })

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.()
    })

    // Prefer onKeyDown: addCommand can fail if Ctrl+W is already claimed.
    const keySub = editor.onKeyDown((e) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod || e.altKey || e.shiftKey) return
      if (e.keyCode !== monaco.KeyCode.KeyW && e.keyCode !== monaco.KeyCode.F4) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      closeActiveEditorFile(() =>
        window.confirm(tRef.current('editor.closeUnsavedConfirm')),
      )
    })

    const clickSub = attachImportClickHandler(monaco, editor)

    const onWinResize = () => remasureWhenFontsReady(editor)
    window.addEventListener('resize', onWinResize)

    return () => {
      window.removeEventListener('resize', onWinResize)
      resizeObserver.disconnect()
      if (preloadTimer.current != null) {
        window.clearTimeout(preloadTimer.current)
        preloadTimer.current = null
      }
      clickSub.dispose()
      keySub.dispose()
      sub.dispose()
      editor.dispose()
      editorRef.current = null
    }
    // Intentionally only depend on path: `value` is applied when opening a file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  return <div className="monaco-host" ref={containerRef} />
}
