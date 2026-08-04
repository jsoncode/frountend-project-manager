import { X } from 'reicon-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n/useI18n'
import {
  TOOL_ORDER,
  useLayoutStore,
  type SideTool,
} from '../stores/layoutStore'
import { useProjectStore } from '../stores/projectStore'
import { CommandPanel } from './CommandPanel'
import { GitToolPanel } from './GitToolPanel'

const TOOL_LABEL: Record<
  SideTool,
  'tool.git' | 'tool.cmd' | 'tool.env'
> = {
  git: 'tool.git',
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
  const openTools = useLayoutStore((s) => s.openTools)
  const setActiveTool = useLayoutStore((s) => s.setActiveTool)
  const persist = useLayoutStore((s) => s.persist)
  const [query, setQuery] = useState('')
  const { t } = useI18n()

  const active: SideTool = openTools[0] ?? 'cmd'
  const q = query.trim()

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

  const renderBody = (): ReactNode => {
    if (!selected && active !== 'cmd') {
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
          <div className="script-tags" style={{ marginBottom: 8, flexDirection: 'column', alignItems: 'stretch' }}>
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
