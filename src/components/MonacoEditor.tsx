import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import { languageFromPath } from '../lib/editorLanguage'
import { setupMonacoEnvironment } from '../lib/monacoEnv'
import { applyEditorTheme, registerEditorThemes } from '../lib/monacoThemes'
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
import { findWorkspaceForPath } from '../lib/workspacePath'
import { useI18n } from '../i18n/useI18n'
import { useSettingsStore } from '../stores/settingsStore'

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

/** Delay before preloading imports after opening / switching a file. */
const PRELOAD_DELAY_MS = 800

/**
 * Files that have already been preloaded (imports resolved into Monaco models).
 * Avoids redundant disk reads + model creation + TS worker re-validation on
 * every subsequent file switch. Capped (LRU-ish) so long sessions don't grow
 * the set without bound (audit L32).
 */
const preloadedFiles = new Map<string, true>()
const MAX_PRELOADED_FILES = 500

function markPreloaded(key: string) {
  preloadedFiles.delete(key)
  preloadedFiles.set(key, true)
  if (preloadedFiles.size > MAX_PRELOADED_FILES) {
    const oldest = preloadedFiles.keys().next().value
    if (oldest !== undefined) preloadedFiles.delete(oldest)
  }
}

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

/**
 * Measure fonts and lay out the editor once fonts are ready. Every scheduled
 * timer and the fonts.ready continuation are tracked and cancelled on dispose
 * — calling layout() on a disposed editor is undefined behaviour in
 * monaco 0.52.2 (audit P2-8). Returns a cleanup function.
 */
function remasureWhenFontsReady(
  editor: monaco.editor.IStandaloneCodeEditor,
): () => void {
  let disposed = false
  const timers: number[] = []
  const run = () => {
    if (disposed) return
    monaco.editor.remeasureFonts()
    editor.layout()
  }
  run()
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    void document.fonts.ready.then(() => run())
  }
  timers.push(window.setTimeout(run, 50))
  timers.push(window.setTimeout(run, 250))
  return () => {
    disposed = true
    for (const id of timers) window.clearTimeout(id)
  }
}

/**
 * Thin Monaco host. A single editor instance is kept alive; switching files
 * only swaps the text model — no destroy / recreate cycle.
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
  const editorTheme = useSettingsStore((s) => s.config?.editorTheme ?? 'vs-dark')
  const workspaces = useSettingsStore((s) => s.config?.workspaces)
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const pathRef = useRef(path)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onOpenFileRef = useRef(onOpenFile)
  const aliasesRef = useRef<PathAlias[]>([])
  const preloadTimer = useRef<number | null>(null)
  const tRef = useRef(t)
  const lastPushedValueRef = useRef('')
  /** Model URI strings this component created — disposed on unmount (audit P1-5). */
  const createdModelsRef = useRef<Set<string>>(new Set())
  pathRef.current = path
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onOpenFileRef.current = onOpenFile
  tRef.current = t

  /**
   * Containment root for import-target disk reads: the workspace containing
   * the project (imports may land in sibling packages or a hoisted
   * node_modules outside the project — audit C1/C2 gate must not break
   * monorepos).
   */
  const wsRoot = findWorkspaceForPath(projectPath, workspaces ?? []) ?? projectPath

  const schedulePreload = (fromFile: string, source: string) => {
    const key = fromFile.toLowerCase()
    if (preloadedFiles.has(key)) return
    if (preloadTimer.current != null) {
      window.clearTimeout(preloadTimer.current)
    }
    preloadTimer.current = window.setTimeout(() => {
      markPreloaded(key)
      const aliases = aliasesRef.current
      if (!aliases.length && !projectPath) return
      void preloadImportsForFile(
        monaco,
        projectPath,
        fromFile,
        source,
        aliases,
        0,
        undefined,
        wsRoot,
      )
    }, PRELOAD_DELAY_MS)
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
      }, wsRoot)
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
  }, [projectPath, wsRoot])

  useEffect(() => {
    setMonacoNavContext(projectPath, aliasesRef.current, (abs) => {
      onOpenFileRef.current?.(abs)
    }, wsRoot)
  }, [projectPath, wsRoot, onOpenFile])

  // --- Editor lifecycle: create ONCE on mount, dispose on unmount ---
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    setupMonacoEnvironment()
    registerEditorThemes(monaco)
    setupMonacoModuleNavigation(monaco)

    const language = languageFromPath(path)
    const text = normalizeEol(value)
    const uri = monaco.Uri.file(path)
    let model = monaco.editor.getModel(uri)
    if (!model) {
      model = monaco.editor.createModel(text, language, uri)
      createdModelsRef.current.add(model.uri.toString())
    } else if (model.getValue() !== text) {
      model.setValue(text)
    }
    lastPushedValueRef.current = text

    const initialWide = el.clientWidth >= MINIMAP_WIDTH_PX
    const editor = monaco.editor.create(el, {
      model,
      automaticLayout: true,
      theme: editorTheme,
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

    // Deferred preload only — avoids blocking the UI on file open.
    schedulePreload(path, text)

    const sub = editor.onDidChangeModelContent(() => {
      const next = editor.getValue()
      onChangeRef.current(next)
      // NOTE: intentionally no schedulePreload here — preloading on every
      // keystroke is the #1 perf killer (reads dozens of files from disk,
      // creates models, triggers TS worker). Preload runs only on file switch.
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

    // resize → remeasure + layout only (no re-scheduling of the fonts.ready
    // timers on every resize — that was a timer pile-up, audit P2-8).
    const onWinResize = () => {
      monaco.editor.remeasureFonts()
      editor.layout()
    }
    window.addEventListener('resize', onWinResize)

    const cancelRemeasure = remasureWhenFontsReady(editor)

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
      cancelRemeasure()
      editor.dispose()
      editorRef.current = null
      // Dispose the models this component created so long sessions stop
      // accumulating file-sized model memory (audit P1-5). Only models we
      // created are touched — tab-close disposal goes through
      // closeEditorFile, and the diff editor uses its own anonymous models.
      const created = createdModelsRef.current
      for (const uriString of created) {
        const m = monaco.editor.getModel(monaco.Uri.parse(uriString))
        if (m) m.dispose()
      }
      created.clear()
    }
    // Editor is created once on mount. Path/value changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Model switching: when path changes, swap the model instead of
  //     destroying and recreating the entire editor. ---
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const uri = monaco.Uri.file(path)
    let model = monaco.editor.getModel(uri)
    const language = languageFromPath(path)
    const text = normalizeEol(value)

    if (!model) {
      // First time opening this file — create with whatever we have.
      model = monaco.editor.createModel(text, language, uri)
      createdModelsRef.current.add(model.uri.toString())
    } else if (text) {
      // Model exists and we have real content (doc already loaded).
      monaco.editor.setModelLanguage(model, language)
      if (model.getValue() !== text) {
        model.setValue(text)
      }
    }
    // When text is '' (doc still loading) and model exists with cached
    // content, we intentionally keep the cached content. The value sync
    // effect will update when the real content arrives.

    // Skip setModel if this model is already active — avoids redundant TS
    // semantic validation which is the main cause of lag on tab switch.
    if (editor.getModel() !== model) {
      editor.setModel(model)
    }
    lastPushedValueRef.current = text
    // Deferred preload — avoids blocking UI on tab switch.
    schedulePreload(path, text || model.getValue())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // --- Sync external value changes (e.g. file loaded from disk) into the
  //     current model.  Skips when the value matches what we last pushed in,
  //     so user keystrokes (which round-trip via onChange) are not overwritten.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const text = normalizeEol(value)
    if (text === lastPushedValueRef.current) return
    lastPushedValueRef.current = text
    const model = editor.getModel()
    if (model && model.getValue() !== text) {
      model.setValue(text)
    }
  }, [value])

  // --- Apply theme changes from settings ---
  useEffect(() => {
    applyEditorTheme(monaco, editorTheme)
  }, [editorTheme])

  return <div className="monaco-host" ref={containerRef} />
}
