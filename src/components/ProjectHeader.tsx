import { X } from 'reicon-react'
import { useEffect } from 'react'
import { useI18n } from '../i18n/useI18n'
import {
  closeActiveEditorFile,
  closeEditorTab,
  isCloseEditorHotkey,
} from '../lib/closeEditorFile'
import { editorPathKey, useEditorStore } from '../stores/editorStore'
import { useExplorerStore } from '../stores/explorerStore'
import { Tooltip } from './Tooltip'

/** Multi-tab title bar above the editor (VS Code–like). */
export function ProjectHeader() {
  const tabs = useEditorStore((s) => s.tabs)
  const activePath = useEditorStore((s) => s.activePath)
  const docs = useEditorStore((s) => s.docs)
  const activateTab = useEditorStore((s) => s.activateTab)
  const setSelection = useExplorerStore((s) => s.setSelection)
  const { t } = useI18n()

  const hasTabs = tabs.length > 0

  useEffect(() => {
    if (!hasTabs) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isCloseEditorHotkey(e)) return
      const target = e.target
      if (
        target instanceof HTMLElement &&
        target.closest('.monaco-host, .monaco-editor')
      ) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      closeActiveEditorFile(() =>
        window.confirm(t('editor.closeUnsavedConfirm')),
      )
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [hasTabs, t])

  if (!hasTabs) return null

  const activeKey = activePath ? editorPathKey(activePath) : null
  const closeTitle = `${t('editor.close')} (Ctrl+W)`

  return (
    <div className="detail-header">
      <div className="editor-tab-list" role="tablist">
        {tabs.map((tab) => {
          const key = editorPathKey(tab.path)
          const name = tab.path.split(/[/\\]/).pop() ?? tab.path
          const doc = docs[key]
          const dirty =
            doc?.status === 'ready' && doc.value !== doc.baseline
          const active = activeKey === key
          return (
            <Tooltip key={key} title={tab.path}>
              <div
                role="tab"
                aria-selected={active}
                className={`editor-tab${active ? ' active' : ''}`}
                onClick={() => {
                  activateTab(tab.path)
                  setSelection({
                    kind: 'file',
                    path: tab.path,
                    projectPath: tab.projectPath,
                  })
                }}
                onMouseDown={(e) => {
                  if (e.button === 1) e.preventDefault()
                }}
                onAuxClick={(e) => {
                  if (e.button !== 1) return
                  e.preventDefault()
                  e.stopPropagation()
                  closeEditorTab(tab.path, () =>
                    window.confirm(t('editor.closeUnsavedConfirm')),
                  )
                }}
              >
                <span className="editor-tab-label">
                  {dirty ? `${name} *` : name}
                </span>
                <Tooltip title={closeTitle}>
                  <button
                    type="button"
                    className="editor-tab-close"
                    aria-label={closeTitle}
                    onClick={(e) => {
                      e.stopPropagation()
                      closeEditorTab(tab.path, () =>
                        window.confirm(t('editor.closeUnsavedConfirm')),
                      )
                    }}
                  >
                    <X size={12} color="currentColor" aria-hidden />
                  </button>
                </Tooltip>
              </div>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
