import { useMemo } from 'react'
import { useI18n } from '../i18n/useI18n'
import { tagKey } from '../lib/types'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

export function ProjectList() {
  const projects = useWorkspaceStore((s) => s.projects)
  const loading = useWorkspaceStore((s) => s.loading)
  const error = useWorkspaceStore((s) => s.error)
  const search = useWorkspaceStore((s) => s.search)
  const setSearch = useWorkspaceStore((s) => s.setSearch)
  const activeTagFilters = useWorkspaceStore((s) => s.activeTagFilters)
  const toggleTagFilter = useWorkspaceStore((s) => s.toggleTagFilter)
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace)
  const config = useSettingsStore((s) => s.config)
  const selected = useProjectStore((s) => s.selected)
  const selectProject = useProjectStore((s) => s.selectProject)
  const { t } = useI18n()

  const allTags = new Set<string>()
  if (config && activeWorkspace) {
    for (const p of projects) {
      const tags = config.tags[tagKey(activeWorkspace, p.folderName)] ?? []
      tags.forEach((tg) => allTags.add(tg))
    }
  }

  const access = config?.projectAccess
  const q = search.trim().toLowerCase()

  const filtered = useMemo(() => {
    const accessMap = access ?? {}
    const list = projects.filter((p) => {
      const tags =
        config && activeWorkspace
          ? (config.tags[tagKey(activeWorkspace, p.folderName)] ?? [])
          : []
      if (activeTagFilters.length > 0) {
        const ok = activeTagFilters.every((tg) => tags.includes(tg))
        if (!ok) return false
      }
      if (!q) return true
      const hay = `${p.folderName} ${p.pkgName ?? ''} ${tags.join(' ')}`.toLowerCase()
      return hay.includes(q)
    })

    return [...list].sort((a, b) => {
      const ta = accessMap[a.path] ?? 0
      const tb = accessMap[b.path] ?? 0
      if (ta !== tb) return tb - ta
      return a.folderName.localeCompare(b.folderName, undefined, {
        sensitivity: 'base',
      })
    })
  }, [projects, config, activeWorkspace, activeTagFilters, q, access])

  return (
    <aside className="list-pane">
      <div className="pane-title">
        {t('projects.title')} <span className="muted">({filtered.length})</span>
      </div>
      <div className="scroll project-scroll">
        {loading && <div className="empty">{t('projects.scanning')}</div>}
        {error && <div className="empty" style={{ color: 'var(--danger)' }}>{error}</div>}
        {!loading && filtered.map((p) => (
          <button
            key={p.path}
            type="button"
            className={`project-capsule ${selected?.path === p.path ? 'active' : ''}`}
            onClick={() => {
              void selectProject(p)
              if (search.trim()) setSearch('')
            }}
          >
            <span className="project-capsule-name">{p.folderName}</span>
            <span className="project-capsule-meta muted">
              {p.pkgName ?? '—'} · v{p.pkgVersion ?? '?'}
              {p.frameworks.length > 0 ? ` · ${p.frameworks.join(',')}` : ''}
            </span>
          </button>
        ))}
        {!loading && !error && filtered.length === 0 && (
          <div className="empty">{t('projects.noMatch')}</div>
        )}
      </div>
      <div className="tags-row">
        <span className="muted" style={{ width: '100%' }}>{t('projects.filterTags')}</span>
        {[...allTags].sort().map((tag) => (
          <button
            key={tag}
            type="button"
            className={`chip ${activeTagFilters.includes(tag) ? 'active' : ''}`}
            onClick={() => toggleTagFilter(tag)}
          >
            #{tag}
          </button>
        ))}
        {allTags.size === 0 && <span className="muted">{t('projects.noTags')}</span>}
      </div>
    </aside>
  )
}
