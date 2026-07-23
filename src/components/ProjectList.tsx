import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useProjectStore } from '../stores/projectStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { OpenWithMenu } from './OpenWithMenu'

export function ProjectList() {
  const projects = useWorkspaceStore((s) => s.projects)
  const loading = useWorkspaceStore((s) => s.loading)
  const error = useWorkspaceStore((s) => s.error)
  const search = useWorkspaceStore((s) => s.search)
  const setSearch = useWorkspaceStore((s) => s.setSearch)
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace)
  const selected = useProjectStore((s) => s.selected)
  const selectProject = useProjectStore((s) => s.selectProject)
  const { t } = useI18n()
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const scrollRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(
    null,
  )

  const q = search.trim().toLowerCase()

  const filtered = useMemo(() => {
    const list = projects.filter((p) => {
      if (!q) return true
      const hay = `${p.folderName} ${p.pkgName ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
    return [...list].sort((a, b) =>
      a.folderName.localeCompare(b.folderName, undefined, {
        sensitivity: 'base',
      }),
    )
  }, [projects, q])

  // When workspace finishes loading (or selection changes), scroll active item into view.
  useEffect(() => {
    if (loading || !selected) return
    const inList = filtered.some((p) => p.path === selected.path)
    if (!inList) return
    const el = itemRefs.current.get(selected.path)
    if (!el) return
    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 40)
    return () => window.clearTimeout(t)
  }, [activeWorkspace, loading, selected?.path, filtered])

  return (
    <aside className="list-pane">
      <div className="pane-title">
        {t('projects.title')} <span className="muted">({filtered.length})</span>
      </div>
      <div className="scroll project-scroll" ref={scrollRef}>
        {loading && <div className="empty">{t('projects.scanning')}</div>}
        {error && (
          <div className="empty" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        )}
        {!loading &&
          filtered.map((p) => (
            <button
              key={p.path}
              type="button"
              ref={(node) => {
                if (node) itemRefs.current.set(p.path, node)
                else itemRefs.current.delete(p.path)
              }}
              className={`project-capsule ${selected?.path === p.path ? 'active' : ''}`}
              onClick={() => {
                void selectProject(p)
                if (search.trim()) setSearch('')
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void selectProject(p)
                setMenu({ path: p.path, x: e.clientX, y: e.clientY })
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

      {menu && (
        <OpenWithMenu
          path={menu.path}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  )
}
