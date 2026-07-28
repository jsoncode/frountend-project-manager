import {
  BranchDown,
  ChevronRight,
  FolderOpen,
  InfoCircle,
  Key,
  Settings,
  TerminalSquare,
} from 'reicon-react'
import { invoke } from '@tauri-apps/api/core'
import type { ReactNode } from 'react'
import { useI18n } from '../i18n/useI18n'
import { showErrorLog } from '../stores/errorLogStore'
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
import { Tooltip } from './Tooltip'

const TOOL_LABEL: Record<
  SideTool,
  'tool.git' | 'tool.cmd' | 'tool.env' | 'tool.meta' | 'tool.ide'
> = {
  git: 'tool.git',
  ide: 'tool.ide',
  cmd: 'tool.cmd',
  env: 'tool.env',
  meta: 'tool.meta',
}

const TOOL_ICON: Partial<Record<SideTool, typeof TerminalSquare>> = {
  git: BranchDown,
  cmd: TerminalSquare,
  env: Key,
  meta: InfoCircle,
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
  const toolPanelWidth = useLayoutStore((s) => s.toolPanelWidth)
  const toggleSideTool = useLayoutStore((s) => s.toggleSideTool)
  const closeSideTool = useLayoutStore((s) => s.closeSideTool)
  const persist = useLayoutStore((s) => s.persist)
  const { t } = useI18n()

  const ides = (config?.ides ?? []).filter((i) => i.enabled)
  const panelsOpen = openTools.length > 0

  const openIde = async (ideId: string) => {
    if (!selected) return
    try {
      await invoke('open_in_ide', { ideId, projectPath: selected.path })
    } catch (e) {
      showErrorLog(e)
    }
  }

  const revealSelected = async () => {
    if (!selected) return
    try {
      await invoke('reveal_in_file_manager', { path: selected.path })
    } catch (e) {
      showErrorLog(e)
    }
  }

  const renderBody = (id: SideTool): ReactNode => {
    if (!selected && id !== 'ide' && id !== 'cmd') {
      return <div className="muted">{t('tool.needProject')}</div>
    }

    if (id === 'cmd') return <CommandPanel />
    if (id === 'git') return <GitToolPanel />

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
          {details?.summary.pkgName && (
            <>
              <div className="pane-sub">{t('meta.package')}</div>
              <div className="muted">
                {details.summary.pkgName}
                {details.packageManager ? ` · ${details.packageManager}` : ''}
              </div>
            </>
          )}
          {(details?.summary.frameworks.length ?? 0) > 0 && (
            <>
              <div
                className="pane-sub"
                style={{ marginTop: details?.summary.pkgName ? 10 : 0 }}
              >
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
          {!details?.summary.pkgName &&
            (details?.summary.frameworks.length ?? 0) === 0 && (
              <span className="muted">—</span>
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
            <Tooltip
              title={
                selected ? t('open.inFileManager') : t('top.ideNeedProject')
              }
            >
              <button
                type="button"
                className="ide-open-item"
                disabled={!selected}
                onClick={() => void revealSelected()}
              >
                <span className="ide-open-folder" aria-hidden>
                  <FolderOpen size={18} color="currentColor" />
                </span>
                <span className="ide-open-name">{t('open.inFileManager')}</span>
              </button>
            </Tooltip>
            {ides.map((ide) => (
              <Tooltip
                key={ide.id}
                title={
                  selected
                    ? t('top.openInIde', { name: ide.name })
                    : t('top.ideNeedProject')
                }
              >
                <button
                  type="button"
                  className="ide-open-item"
                  disabled={!selected}
                  onClick={() => void openIde(ide.id)}
                >
                  <IdeIcon iconPath={ide.iconPath} name={ide.name} size={22} />
                  <span className="ide-open-name">{ide.name}</span>
                </button>
              </Tooltip>
            ))}
            {ides.length === 0 && (
              <div className="muted">{t('top.noIde')}</div>
            )}
          </div>
          <button
            type="button"
            className="btn btn-sm btn-with-icon"
            style={{ marginTop: 12 }}
            onClick={() => setIdeModalOpen(true)}
          >
            <Settings className="ui-icon" size={14} color="currentColor" aria-hidden />
            {t('settings.openIde')}
          </button>
        </>
      )
    }

    return null
  }

  return (
    <div className="tool-window mode-single">
      {panelsOpen && (
        <>
          <ResizeHandle
            orientation="vertical"
            onDrag={(d) => {
              const { toolPanelWidth, setToolPanelWidth } =
                useLayoutStore.getState()
              // Handle is on the left edge: drag left → wider panel
              setToolPanelWidth(toolPanelWidth - d)
            }}
            onDragEnd={persist}
          />
          <div
            className="tool-panels-col single"
            style={{ width: toolPanelWidth }}
          >
            {openTools.slice(0, 1).map((id) => (
              <aside key={id} className="tool-panel">
                <div className="tool-panel-head">
                  <h2>{t(TOOL_LABEL[id])}</h2>
                  <Tooltip title={t('tool.collapse')}>
                    <button
                      type="button"
                      className="btn btn-sm tool-panel-close"
                      onClick={() => {
                        closeSideTool(id)
                        persist()
                      }}
                    >
                      <ChevronRight className="ui-icon" size={16} color="currentColor" aria-hidden />
                    </button>
                  </Tooltip>
                </div>
                <div className="tool-panel-body">{renderBody(id)}</div>
              </aside>
            ))}
          </div>
        </>
      )}

      <nav className="tool-strip" aria-label={t('tool.strip')}>
        {TOOL_ORDER.map((id) => {
          const Icon = TOOL_ICON[id]
          return (
            <Tooltip key={id} title={t(TOOL_LABEL[id])}>
              <button
                type="button"
                className={`tool-strip-btn ${openTools.includes(id) ? 'active' : ''}`}
                aria-label={t(TOOL_LABEL[id])}
                aria-pressed={openTools.includes(id)}
                onClick={() => {
                  toggleSideTool(id)
                  persist()
                }}
              >
                {id === 'ide' ? (
                  <span className="tool-strip-label">IDE</span>
                ) : Icon ? (
                  <span className="tool-strip-icon">
                    <Icon size={18} color="currentColor" aria-hidden />
                  </span>
                ) : null}
              </button>
            </Tooltip>
          )
        })}
      </nav>
    </div>
  )
}
