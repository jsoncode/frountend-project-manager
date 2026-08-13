import { X } from 'reicon-react'
import { useState, type ReactNode } from 'react'
import { useI18n } from '../i18n/useI18n'
import {
  TOOL_ORDER,
  useLayoutStore,
  type SideTool,
} from '../stores/layoutStore'
import { useProjectStore } from '../stores/projectStore'
import { CommandPanel } from './CommandPanel'
import { GitToolPanel } from './GitToolPanel'

const TOOL_LABEL: Record<SideTool, 'tool.git' | 'tool.cmd'> = {
  git: 'tool.git',
  cmd: 'tool.cmd',
}

/** Action bar — sits to the right of the file explorer. */
export function ActionBar() {
  const selected = useProjectStore((s) => s.selected)
  const openTools = useLayoutStore((s) => s.openTools)
  const setActiveTool = useLayoutStore((s) => s.setActiveTool)
  const persist = useLayoutStore((s) => s.persist)
  const [query, setQuery] = useState('')
  const { t } = useI18n()

  const active: SideTool = openTools[0] ?? 'cmd'

  const renderBody = (): ReactNode => {
    if (!selected && active !== 'cmd') {
      return <div className="muted">{t('tool.needProject')}</div>
    }

    if (active === 'cmd') return <CommandPanel filterQuery={query} />
    if (active === 'git') return <GitToolPanel filterQuery={query} />

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
