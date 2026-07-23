import { invoke } from '@tauri-apps/api/core'
import { useState, type ReactNode } from 'react'
import { useI18n } from '../i18n/useI18n'
import {
  TOOL_ORDER,
  useLayoutStore,
  type SideTool,
} from '../stores/layoutStore'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { CommandPanel } from './CommandPanel'
import { GitToolPanel } from './GitToolPanel'
import { IdeIcon } from './IdeIcon'
import { ResizeHandle } from './ResizeHandle'

const TOOL_LABEL: Record<
  SideTool,
  'tool.cmd' | 'tool.git' | 'tool.env' | 'tool.meta' | 'tool.ide'
> = {
  ide: 'tool.ide',
  cmd: 'tool.cmd',
  git: 'tool.git',
  env: 'tool.env',
  meta: 'tool.meta',
}

export function ToolWindow() {
  const selected = useProjectStore((s) => s.selected)
  const details = useProjectStore((s) => s.details)
  const envFiles = useProjectStore((s) => s.envFiles)
  const envEntries = useProjectStore((s) => s.envEntries)
  const selectedEnvPath = useProjectStore((s) => s.selectedEnvPath)
  const revealEnv = useProjectStore((s) => s.revealEnv)
  const loadEnvEntries = useProjectStore((s) => s.loadEnvEntries)
  const setRevealEnv = useProjectStore((s) => s.setRevealEnv)
  const config = useSettingsStore((s) => s.config)
  const setIdeModalOpen = useSettingsStore((s) => s.setIdeModalOpen)
  const openTools = useLayoutStore((s) => s.openTools)
  const toolLayoutMode = useLayoutStore((s) => s.toolLayoutMode)
  const toolPanelWidth = useLayoutStore((s) => s.toolPanelWidth)
  const toggleSideTool = useLayoutStore((s) => s.toggleSideTool)
  const closeSideTool = useLayoutStore((s) => s.closeSideTool)
  const setToolLayoutMode = useLayoutStore((s) => s.setToolLayoutMode)
  const persist = useLayoutStore((s) => s.persist)
  const [ideError, setIdeError] = useState<string | null>(null)
  const { t } = useI18n()

  const ides = (config?.ides ?? []).filter((i) => i.enabled)
  const panelsOpen = openTools.length > 0

  const openIde = async (ideId: string) => {
    if (!selected) return
    setIdeError(null)
    try {
      await invoke('open_in_ide', { ideId, projectPath: selected.path })
    } catch (e) {
      setIdeError(String(e))
    }
  }

  const revealSelected = async () => {
    if (!selected) return
    setIdeError(null)
    try {
      await invoke('reveal_in_file_manager', { path: selected.path })
    } catch (e) {
      setIdeError(String(e))
    }
  }

  const renderBody = (id: SideTool): ReactNode => {
    if (!selected && id !== 'ide' && id !== 'cmd') {
      return <div className="muted">{t('tool.needProject')}</div>
    }

    if (id === 'cmd') return <CommandPanel />
    if (id === 'git' && selected) return <GitToolPanel />

    if (id === 'env' && selected) {
      return (
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
      )
    }

    if (id === 'meta' && selected) {
      return (
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
          {details?.summary.pkgName && (
            <>
              <div className="pane-sub" style={{ marginTop: 10 }}>
                {t('meta.package')}
              </div>
              <div className="muted">
                {details.summary.pkgName}
                {details.summary.pkgVersion
                  ? ` · v${details.summary.pkgVersion}`
                  : ''}
                {details.packageManager ? ` · ${details.packageManager}` : ''}
              </div>
            </>
          )}
          {(details?.summary.frameworks.length ?? 0) > 0 && (
            <>
              <div className="pane-sub" style={{ marginTop: 10 }}>
                {t('meta.frameworks')}
              </div>
              <div className="script-tags">
                {details!.summary.frameworks.map((f) => (
                  <span key={f} className="script-tag static">
                    {f}
                  </span>
                ))}
              </div>
            </>
          )}
        </>
      )
    }

    if (id === 'ide') {
      return (
        <>
          <p className="muted" style={{ margin: '0 0 10px' }}>
            {selected ? t('tool.ideHint') : t('top.ideNeedProject')}
          </p>
          <div className="ide-open-list">
            <button
              type="button"
              className="ide-open-item"
              disabled={!selected}
              title={
                selected ? t('open.inFileManager') : t('top.ideNeedProject')
              }
              onClick={() => void revealSelected()}
            >
              <span className="ide-open-folder" aria-hidden>
                ⌂
              </span>
              <span className="ide-open-name">{t('open.inFileManager')}</span>
            </button>
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
      )
    }

    return null
  }

  return (
    <div className={`tool-window mode-${toolLayoutMode}`}>
      {panelsOpen && (
        <>
          <ResizeHandle
            orientation="vertical"
            onDrag={(d) => {
              const { toolPanelWidth, setToolPanelWidth } =
                useLayoutStore.getState()
              // Handle is on the left of the panel: drag right → wider
              setToolPanelWidth(toolPanelWidth + d)
            }}
            onDragEnd={persist}
          />
          <div
            className={`tool-panels-col ${toolLayoutMode === 'stack' ? 'stack' : 'single'}`}
            style={{ width: toolPanelWidth }}
          >
            {openTools.map((id) => (
              <aside key={id} className="tool-panel">
                <div className="tool-panel-head">
                  <h2>{t(TOOL_LABEL[id])}</h2>
                  <button
                    type="button"
                    className="btn btn-sm tool-panel-close"
                    title={t('tool.collapse')}
                    onClick={() => {
                      closeSideTool(id)
                      persist()
                    }}
                  >
                    ›
                  </button>
                </div>
                <div className="tool-panel-body">{renderBody(id)}</div>
              </aside>
            ))}
          </div>
        </>
      )}

      <nav className="tool-strip" aria-label={t('tool.strip')}>
        <button
          type="button"
          className={`tool-strip-mode ${toolLayoutMode === 'stack' ? 'active' : ''}`}
          title={
            toolLayoutMode === 'stack'
              ? t('tool.modeStackHint')
              : t('tool.modeSingleHint')
          }
          onClick={() => {
            setToolLayoutMode(toolLayoutMode === 'stack' ? 'single' : 'stack')
            persist()
          }}
        >
          {toolLayoutMode === 'stack' ? t('tool.modeStack') : t('tool.modeSingle')}
        </button>
        {TOOL_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            className={`tool-strip-btn ${openTools.includes(id) ? 'active' : ''}`}
            title={t(TOOL_LABEL[id])}
            aria-pressed={openTools.includes(id)}
            onClick={() => {
              toggleSideTool(id)
              persist()
            }}
          >
            <span className="tool-strip-label">{t(TOOL_LABEL[id])}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
