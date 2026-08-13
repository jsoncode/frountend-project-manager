import { SearchOutlined } from '@ant-design/icons'
import { Input, Segmented } from 'antd'
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
        <Input
          size="small"
          allowClear
          prefix={<SearchOutlined style={{ fontSize: 11, opacity: 0.7 }} />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('actionBar.searchPlaceholder')}
          aria-label={t('actionBar.searchPlaceholder')}
          className="action-bar-search"
        />
      </div>

      <Segmented
        className="action-bar-tabs"
        size="small"
        value={active}
        options={TOOL_ORDER.map((id) => ({
          label: t(TOOL_LABEL[id]),
          value: id,
        }))}
        onChange={(v) => {
          setActiveTool(v as SideTool)
          persist()
        }}
      />

      <div className="action-bar-body">{renderBody()}</div>
    </aside>
  )
}
