import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { tagKey } from '../lib/types'
import { useLayoutStore, type SideTool } from '../stores/layoutStore'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { CommandPanel } from './CommandPanel'
import { GitToolPanel } from './GitToolPanel'
import { IdeIcon } from './IdeIcon'
import { ResizeHandle } from './ResizeHandle'

const TOOLS: {
  id: SideTool
  labelKey: 'tool.cmd' | 'tool.git' | 'tool.env' | 'tool.meta' | 'tool.ide'
}[] = [
  { id: 'cmd', labelKey: 'tool.cmd' },
  { id: 'git', labelKey: 'tool.git' },
  { id: 'env', labelKey: 'tool.env' },
  { id: 'meta', labelKey: 'tool.meta' },
  { id: 'ide', labelKey: 'tool.ide' },
]

export function ToolWindow() {
  const selected = useProjectStore((s) => s.selected)
  const details = useProjectStore((s) => s.details)
  const envFiles = useProjectStore((s) => s.envFiles)
  const envEntries = useProjectStore((s) => s.envEntries)
  const selectedEnvPath = useProjectStore((s) => s.selectedEnvPath)
  const revealEnv = useProjectStore((s) => s.revealEnv)
  const loadEnvEntries = useProjectStore((s) => s.loadEnvEntries)
  const setRevealEnv = useProjectStore((s) => s.setRevealEnv)
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace)
  const config = useSettingsStore((s) => s.config)
  const setProjectTags = useSettingsStore((s) => s.setProjectTags)
  const setIdeModalOpen = useSettingsStore((s) => s.setIdeModalOpen)
  const sideTool = useLayoutStore((s) => s.sideTool)
  const toolPanelWidth = useLayoutStore((s) => s.toolPanelWidth)
  const toggleSideTool = useLayoutStore((s) => s.toggleSideTool)
  const persist = useLayoutStore((s) => s.persist)
  const [tagInput, setTagInput] = useState('')
  const [ideError, setIdeError] = useState<string | null>(null)
  const { t } = useI18n()

  const tags =
    selected && config && activeWorkspace
      ? (config.tags[tagKey(activeWorkspace, selected.folderName)] ?? [])
      : []
  const ides = (config?.ides ?? []).filter((i) => i.enabled)

  const addTag = async () => {
    if (!selected || !activeWorkspace || !tagInput.trim()) return
    const next = [...new Set([...tags, tagInput.trim().replace(/^#/, '')])]
    await setProjectTags(activeWorkspace, selected.folderName, next)
    setTagInput('')
  }

  const removeTag = async (tag: string) => {
    if (!selected || !activeWorkspace) return
    await setProjectTags(
      activeWorkspace,
      selected.folderName,
      tags.filter((tg) => tg !== tag),
    )
  }

  const openIde = async (ideId: string) => {
    if (!selected) return
    setIdeError(null)
    try {
      await invoke('open_in_ide', { ideId, projectPath: selected.path })
    } catch (e) {
      setIdeError(String(e))
    }
  }

  const activeMeta = TOOLS.find((x) => x.id === sideTool)

  return (
    <div className="tool-window">
      {sideTool && (
        <>
          <aside className="tool-panel" style={{ width: toolPanelWidth }}>
            <div className="tool-panel-head">
              <h2>{activeMeta ? t(activeMeta.labelKey) : ''}</h2>
              <button
                type="button"
                className="btn btn-sm tool-panel-close"
                title={t('tool.collapse')}
                onClick={() => toggleSideTool(sideTool)}
              >
                ›
              </button>
            </div>
            <div className="tool-panel-body">
              {!selected && sideTool !== 'ide' && sideTool !== 'cmd' && (
                <div className="muted">{t('tool.needProject')}</div>
              )}

              {sideTool === 'cmd' && <CommandPanel />}

              {sideTool === 'git' && selected && <GitToolPanel />}

              {sideTool === 'env' && selected && (
                <>
                  <div className="script-tags" style={{ marginBottom: 8 }}>
                    {envFiles.map((f) => (
                      <button
                        key={f.path}
                        type="button"
                        className={`script-tag ${selectedEnvPath === f.path ? 'active' : ''}`}
                        onClick={() => void loadEnvEntries(f.path)}
                      >
                        {f.name}
                      </button>
                    ))}
                    {envFiles.length === 0 && (
                      <span className="muted">{t('env.none')}</span>
                    )}
                  </div>
                  {selectedEnvPath && (
                    <>
                      <label
                        className="muted"
                        style={{ display: 'flex', gap: 8, marginBottom: 6 }}
                      >
                        <input
                          type="checkbox"
                          checked={revealEnv}
                          onChange={(e) => setRevealEnv(e.target.checked)}
                        />
                        {t('env.reveal')}
                      </label>
                      <table className="env-table">
                        <tbody>
                          {envEntries.map((e) => (
                            <tr key={e.key}>
                              <td>{e.key}</td>
                              <td>{revealEnv ? e.value : '••••••'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </>
              )}

              {sideTool === 'meta' && selected && (
                <>
                  <div className="pane-sub">{t('meta.lang')}</div>
                  <div className="script-tags">
                    {(details?.languages ?? []).map((l) => (
                      <span key={l} className="script-tag static">
                        {l}
                      </span>
                    ))}
                    {(details?.languages.length ?? 0) === 0 && (
                      <span className="muted">—</span>
                    )}
                  </div>
                  <div className="pane-sub" style={{ marginTop: 10 }}>
                    {t('meta.tags')}
                  </div>
                  <div className="script-tags">
                    {tags.map((tg) => (
                      <button
                        key={tg}
                        type="button"
                        className="script-tag active"
                        onClick={() => void removeTag(tg)}
                      >
                        #{tg} ×
                      </button>
                    ))}
                  </div>
                  <div className="command-row">
                    <input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      placeholder="#tag"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void addTag()
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void addTag()}
                    >
                      +
                    </button>
                  </div>
                </>
              )}

              {sideTool === 'ide' && (
                <>
                  <p className="muted" style={{ margin: '0 0 10px' }}>
                    {selected ? t('tool.ideHint') : t('top.ideNeedProject')}
                  </p>
                  <div className="ide-open-list">
                    {ides.map((ide) => (
                      <button
                        key={ide.id}
                        type="button"
                        className="ide-open-item"
                        disabled={!selected}
                        title={
                          selected
                            ? t('top.openInIde', { name: ide.name })
                            : t('top.ideNeedProject')
                        }
                        onClick={() => void openIde(ide.id)}
                      >
                        <IdeIcon iconPath={ide.iconPath} name={ide.name} size={22} />
                        <span className="ide-open-name">{ide.name}</span>
                      </button>
                    ))}
                    {ides.length === 0 && (
                      <div className="muted">{t('top.noIde')}</div>
                    )}
                  </div>
                  {ideError && (
                    <div className="status-banner dirty" style={{ marginTop: 10 }}>
                      {ideError}
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ marginTop: 12 }}
                    onClick={() => setIdeModalOpen(true)}
                  >
                    {t('settings.openIde')}
                  </button>
                </>
              )}
            </div>
          </aside>
          <ResizeHandle
            orientation="vertical"
            onDrag={(d) => {
              const { toolPanelWidth, setToolPanelWidth } = useLayoutStore.getState()
              setToolPanelWidth(toolPanelWidth - d)
            }}
            onDragEnd={persist}
          />
        </>
      )}

      <nav className="tool-strip" aria-label={t('tool.strip')}>
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`tool-strip-btn ${sideTool === tool.id ? 'active' : ''}`}
            title={t(tool.labelKey)}
            aria-pressed={sideTool === tool.id}
            onClick={() => {
              toggleSideTool(tool.id)
              persist()
            }}
          >
            <span className="tool-strip-label">{t(tool.labelKey)}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
