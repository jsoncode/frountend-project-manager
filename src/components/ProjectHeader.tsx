import { Tabs } from 'antd'
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

/** Multi-tab title bar above the editor (VS Code–like), on antd Tabs. */
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
  const byKey = new Map(tabs.map((tab) => [editorPathKey(tab.path), tab]))

  const switchTo = (key: string) => {
    const tab = byKey.get(key)
    if (!tab) return
    activateTab(tab.path)
    setSelection({
      kind: 'file',
      path: tab.path,
      projectPath: tab.projectPath,
    })
  }

  const items = tabs.map((tab) => {
    const key = editorPathKey(tab.path)
    const name = tab.path.split(/[/\\]/).pop() ?? tab.path
    const doc = docs[key]
    const dirty = doc?.status === 'ready' && doc.value !== doc.baseline
    return {
      key,
      label: (
        <Tooltip title={tab.path}>
          <span
            className={`editor-tab-label${dirty ? ' is-dirty' : ''}`}
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
            {dirty ? `${name} *` : name}
          </span>
        </Tooltip>
      ),
      closeIcon: (
        <span aria-label={closeTitle} title={closeTitle}>
          ×
        </span>
      ),
    }
  })

  return (
    <div className="detail-header">
      <Tabs
        className="editor-tabs"
        type="editable-card"
        hideAdd
        size="small"
        activeKey={activeKey ?? undefined}
        items={items}
        onChange={switchTo}
        onEdit={(targetKey, action) => {
          if (action !== 'remove' || typeof targetKey !== 'string') return
          const tab = byKey.get(targetKey)
          if (!tab) return
          closeEditorTab(tab.path, () =>
            window.confirm(t('editor.closeUnsavedConfirm')),
          )
        }}
      />
    </div>
  )
}
