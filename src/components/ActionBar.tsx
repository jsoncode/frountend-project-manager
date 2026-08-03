import { FolderOpen, Settings, X } from 'reicon-react'
import { invoke } from '@tauri-apps/api/core'
import { useMemo, useState, type ReactNode } from 'react'
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
import { Tooltip } from './Tooltip'

const TOOL_LABEL: Record<
  SideTool,
  'tool.git' | 'tool.cmd' | 'tool.env' | 'tool.ide'
> = {
  git: 'tool.git',
  ide: 'tool.ide',
  cmd: 'tool.cmd',
  env: 'tool.env',
}

function matchesQuery(text: string, q: string) {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return text.toLowerCase().includes(needle)
}

/** Action bar — sits to the right of the file explorer. */
export function ActionBar() {
  const selected = useProjectStore((s) => s.selected)
  const envFiles = useProjectStore((s) => s.envFiles)
  const envEntries = useProjectStore((s) => s.envEntries)
  const selectedEnvPath = useProjectStore((s) => s.selectedEnvPath)
  const revealEnv = useProjectStore((s) => s.revealEnv)
  const loadEnvEntries = useProjectStore((s) => s.loadEnvEntries)
  const setRevealEnv = useProjectStore((s) => s.setRevealEnv)
  const config = useSettingsStore((s) => s.config)
  const setIdeModalOpen = useSettingsStore((s) => s.setIdeModalOpen)
  const openTools = useLayoutStore((s) => s.openTools)
  const setActiveTool = useLayoutStore((s) => s.setActiveTool)
  const persist = useLayoutStore((s) => s.persist)
  const [query, setQuery] = useState('')
  const { t } = useI18n()

  const active: SideTool = openTools[0] ?? 'cmd'
  const ides = (config?.ides ?? []).filter((i) => i.enabled)
  const q = query.trim()

  const filteredIdes = useMemo(
    () => ides.filter((ide) => matchesQuery(ide.name, q)),
    [ides, q],
  )

  const filteredEnvFiles = useMemo(
    () => envFiles.filter((f) => matchesQuery(f.name, q)),
    [envFiles, q],
  )

  const filteredEnvEntries = useMemo(
    () =>
      envEntries.filter(
        (e) => matchesQuery(e.key, q) || matchesQuery(e.value, q),
      ),
    [envEntries, q],
  )

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

  const renderBody = (): ReactNode => {
    if (!selected && active !== 'ide' && active !== 'cmd') {
      return <div className="muted">{t('tool.needProject')}</div>
    }

    if (active === 'cmd') return <CommandPanel filterQuery={query} />
    if (active === 'git') return <GitToolPanel filterQuery={query} />

    if (active === 'env') {
      if (!selected) {
        return <div className="muted">{t('tool.needProject')}</div>
      }
      return (
        <>
          <div className="script-tags" style={{ marginBottom: 8 }}>
            {filteredEnvFiles.map((f) => (
              <button
                key={f.path}
                type="button"
                className={`script-tag ${selectedEnvPath === f.path ? 'active' : ''}`}
                onClick={() => void loadEnvEntries(f.path)}
              >
                {f.name}
              </button>
            ))}
            {filteredEnvFiles.length === 0 && (
              <span className="muted">
                {q ? t('actionBar.noMatch') : t('env.none')}
              </span>
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
                  {filteredEnvEntries.map((e) => (
                    <tr key={e.key}>
                      <td>{e.key}</td>
                      <td>{revealEnv ? e.value : '••••••'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredEnvEntries.length === 0 && q ? (
                <div className="muted">{t('actionBar.noMatch')}</div>
              ) : null}
            </>
          )}
        </>
      )
    }

    if (active === 'ide') {
      const showFm =
        !q ||
        matchesQuery(t('open.inFileManager'), q) ||
        matchesQuery('file', q)
      return (
        <>
          <p className="muted" style={{ margin: '0 0 10px' }}>
            {selected ? t('tool.ideHint') : t('top.ideNeedProject')}
          </p>
          <div className="ide-open-list">
            {showFm ? (
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
                  <span className="ide-open-name">
                    {t('open.inFileManager')}
                  </span>
                </button>
              </Tooltip>
            ) : null}
            {filteredIdes.map((ide) => (
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
            {filteredIdes.length === 0 && ides.length === 0 && (
              <div className="muted">{t('top.noIde')}</div>
            )}
            {filteredIdes.length === 0 && ides.length > 0 && q && (
              <div className="muted">{t('actionBar.noMatch')}</div>
            )}
          </div>
          <button
            type="button"
            className="btn btn-sm btn-with-icon"
            style={{ marginTop: 12 }}
            onClick={() => setIdeModalOpen(true)}
          >
            <Settings
              className="ui-icon"
              size={14}
              color="currentColor"
              aria-hidden
            />
            {t('settings.openIde')}
          </button>
        </>
      )
    }

    return null
  }

  return (
    <aside className="action-bar" aria-label={t('actionBar.title')}>
      <div className="action-bar-head">
        <h2 className="action-bar-title">{t('actionBar.title')}</h2>
        <div className="action-bar-search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('actionBar.searchPlaceholder')}
            aria-label={t('actionBar.searchPlaceholder')}
          />
          {query ? (
            <button
              type="button"
              className="action-bar-search-clear"
              aria-label={t('actionBar.clearSearch')}
              onClick={() => setQuery('')}
            >
              <X className="ui-icon" size={12} color="currentColor" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      <nav className="action-bar-tabs" aria-label={t('actionBar.tabs')}>
        {TOOL_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            className={`action-bar-tab${active === id ? ' active' : ''}`}
            aria-selected={active === id}
            onClick={() => {
              setActiveTool(id)
              persist()
            }}
          >
            {t(TOOL_LABEL[id])}
          </button>
        ))}
      </nav>

      <div className="action-bar-body">{renderBody()}</div>
    </aside>
  )
}
