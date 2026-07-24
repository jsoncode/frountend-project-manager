import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { projectGroupKey, projectGroupTint } from '../lib/projectGroup'
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

  const groups = useMemo(() => {
    const result: { key: string; tint: string; items: typeof filtered }[] = []
    for (const p of filtered) {
      const key = projectGroupKey(p.folderName)
      const last = result[result.length - 1]
      if (last && last.key === key) {
        last.items.push(p)
      } else {
        result.push({ key, tint: projectGroupTint(key), items: [p] })
      }
    }
    return result
  }, [filtered])

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

  const canLocate =
    !!selected && !loading && filtered.some((p) => p.path === selected.path)

  const locateSelected = () => {
    if (!selected) return
    const el = itemRefs.current.get(selected.path)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <aside className="list-pane">
      <div className="pane-title-row">
        <div className="pane-title">
          {t('projects.title')} <span className="muted">({filtered.length})</span>
        </div>
        <div className="pane-title-actions">
          <button
            type="button"
            className="icon-btn"
            disabled={!canLocate}
            title={t('projects.locate')}
            aria-label={t('projects.locate')}
            onClick={locateSelected}
          >
            ⌖
          </button>
        </div>
      </div>
      <div className="scroll project-scroll" ref={scrollRef}>
        {loading && <div className="empty">{t('projects.scanning')}</div>}
        {error && (
          <div className="empty" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        )}
        {!loading &&
          groups.map((g) => (
            <div
              key={g.key}
              className="project-group"
              style={{ ['--project-group-bg' as string]: g.tint }}
            >
              <div className="project-group-mark" aria-hidden>
                {g.key}
              </div>
              {g.items.map((p) => (
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
            </div>
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
