import * as monaco from 'monaco-editor'
import { findWorkspaceForPath } from './workspacePath'
import {
  editorPathKey,
  useEditorStore,
} from '../stores/editorStore'
import { useExplorerStore } from '../stores/explorerStore'
import { useSettingsStore } from '../stores/settingsStore'

/**
 * Close the active editor tab (VS Code Ctrl+W).
 * Returns true if closed (or nothing to close), false if user cancelled unsaved prompt.
 */
export function closeActiveEditorFile(
  confirmUnsaved: () => boolean,
): boolean {
  const editor = useEditorStore.getState()
  const activePath = editor.activePath
  if (!activePath) return true
  return closeEditorTab(activePath, confirmUnsaved)
}

/** Close a specific tab by path. */
export function closeEditorTab(
  path: string,
  confirmUnsaved: () => boolean,
): boolean {
  const editor = useEditorStore.getState()
  if (findTab(path) == null) return true

  if (editor.isTabDirty(path) && !confirmUnsaved()) return false

  // Drop Monaco model for this tab (keep others open).
  try {
    monaco.editor.getModel(monaco.Uri.file(path))?.dispose()
  } catch {
    /* ignore */
  }

  const tab = findTab(path)
  const projectPath = tab?.projectPath
  editor.closeTab(path)

  syncSelectionAfterClose(projectPath)
  return true
}

function findTab(path: string) {
  const key = editorPathKey(path)
  return useEditorStore
    .getState()
    .tabs.find((t) => editorPathKey(t.path) === key)
}

function syncSelectionAfterClose(closedProjectPath?: string) {
  const { activePath } = useEditorStore.getState()
  const setSelection = useExplorerStore.getState().setSelection

  if (activePath) {
    const tab = findTab(activePath)
    if (tab) {
      setSelection({
        kind: 'file',
        path: tab.path,
        projectPath: tab.projectPath,
      })
      return
    }
  }

  const projectPath = closedProjectPath || projectPathFallback()
  if (projectPath) {
    const workspaces =
      useSettingsStore.getState().config?.workspaces ?? []
    const workspace = findWorkspaceForPath(projectPath, workspaces) || ''
    setSelection({
      kind: 'project',
      path: projectPath,
      workspace,
    })
  }
}

function projectPathFallback(): string | null {
  const tabs = useEditorStore.getState().tabs
  if (tabs[0]) return tabs[0].projectPath
  const sel = useExplorerStore.getState().selection
  if (sel?.kind === 'file' || sel?.kind === 'dir') return sel.projectPath
  if (sel?.kind === 'project') return sel.path
  return null
}

/** True when Ctrl/Cmd+W (or Ctrl+F4) should close the editor tab. */
export function isCloseEditorHotkey(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey
  if (!mod || e.altKey) return false
  const key = e.key.toLowerCase()
  if (key === 'w' && !e.shiftKey) return true
  if (key === 'f4' && !e.shiftKey) return true
  return false
}
