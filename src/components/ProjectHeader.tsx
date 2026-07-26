import { X } from 'reicon-react'
import { useI18n } from '../i18n/useI18n'
import { normalizeFsPath } from '../lib/gitDecorations'
import { findWorkspaceForPath } from '../lib/workspacePath'
import { useEditorStore } from '../stores/editorStore'
import { useExplorerStore } from '../stores/explorerStore'
import { useSettingsStore } from '../stores/settingsStore'

/** Tab-style title above the editor — filename, dirty `*`, and close (VS Code–like). */
export function ProjectHeader() {
  const selection = useExplorerStore((s) => s.selection)
  const setSelection = useExplorerStore((s) => s.setSelection)
  const dirtyPath = useEditorStore((s) => s.dirtyPath)
  const setDirtyPath = useEditorStore((s) => s.setDirtyPath)
  const workspaces = useSettingsStore((s) => s.config?.workspaces ?? [])
  const { t } = useI18n()

  if (selection?.kind !== 'file') return null

  const name = selection.path.split(/[/\\]/).pop() ?? selection.path
  const dirty =
    dirtyPath != null &&
    normalizeFsPath(dirtyPath) === normalizeFsPath(selection.path)

  const closeFile = () => {
    if (dirty) {
      const ok = window.confirm(t('editor.closeUnsavedConfirm'))
      if (!ok) return
    }
    setDirtyPath(null)
    const workspace =
      findWorkspaceForPath(selection.projectPath, workspaces) || ''
    setSelection({
      kind: 'project',
      path: selection.projectPath,
      workspace,
    })
  }

  return (
    <div className="detail-header">
      <div className="editor-tab" title={selection.path}>
        <span className="editor-tab-label">
          {dirty ? `${name} *` : name}
        </span>
        <button
          type="button"
          className="editor-tab-close"
          title={t('editor.close')}
          aria-label={t('editor.close')}
          onClick={(e) => {
            e.stopPropagation()
            closeFile()
          }}
        >
          <X size={12} color="currentColor" aria-hidden />
        </button>
      </div>
    </div>
  )
}
