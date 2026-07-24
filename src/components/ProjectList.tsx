import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { projectGroupKey, projectGroupTint } from '../lib/projectGroup'
import { projectMatchesQuery, projectSubtitle } from '../lib/projectSearch'
import {
  findWorkspaceForPath,
  shortWorkspaceName,
} from '../lib/workspacePath'
import type { ProjectSummary } from '../lib/types'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { OpenWithMenu } from './OpenWithMenu'

type ListedProject = ProjectSummary & { workspace: string }

export function ProjectList() {
  const projects = useWorkspaceStore((s) => s.projects)
  const projectCache = useWorkspaceStore((s) => s.projectCache)
  const loading = useWorkspaceStore((s) => s.loading)
  const searchScanning = useWorkspaceStore((s) => s.searchScanning)
  const error = useWorkspaceStore((s) => s.error)
  const search = useWorkspaceStore((s) => s.search)
  const setSearch = useWorkspaceStore((s) => s.setSearch)
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace)
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace)
  const selected = useProjectStore((s) => s.selected)
  const selectProject = useProjectStore((s) => s.selectProject)
  const touchSearchHistory = useSettingsStore((s) => s.touchSearchHistory)
  const workspaces = useSettingsStore((s) => s.config?.workspaces ?? [])
  const { t } = useI18n()
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const scrollRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(
    null,
  )

  const q = search.trim()
  const searching = q.length > 0

  const source = useMemo((): ListedProject[] => {
    if (!searching) {
      const ws = activeWorkspace
      if (!ws) return []
      return projects.map((p) => ({ ...p, workspace: ws }))
    }
    const out: ListedProject[] = []
    const seen = new Set<string>()
    for (const ws of workspaces) {
      const list = projectCache[ws] ?? []
      for (const p of list) {
        if (seen.has(p.path)) continue
        seen.add(p.path)
        out.push({ ...p, workspace: ws })
      }
    }
    // Projects from cache keys not in current config (shouldn't happen often)
    for (const [ws, list] of Object.entries(projectCache)) {
      if (workspaces.includes(ws)) continue
      for (const p of list) {
        if (seen.has(p.path)) continue
        seen.add(p.path)
        out.push({ ...p, workspace: ws })
      }
    }
    return out
  }, [searching, activeWorkspace, projects, projectCache, workspaces])

  const filtered = useMemo(() => {
    const list = source.filter((p) => projectMatchesQuery(p, q))
    return [...list].sort((a, b) => {
      if (searching) {
        const wa = shortWorkspaceName(a.workspace).localeCompare(
          shortWorkspaceName(b.workspace),
          undefined,
          { sensitivity: 'base' },
        )
        if (wa !== 0) return wa
      }
      return a.folderName.localeCompare(b.folderName, undefined, {
        sensitivity: 'base',
      })
    })
  }, [source, q, searching])

  const groups = useMemo(() => {
    const result: { key: string; tint: string; items: ListedProject[] }[] = []
    for (const p of filtered) {
      const key = searching
        ? shortWorkspaceName(p.workspace)
        : projectGroupKey(p.folderName)
      const tint = searching
        ? projectGroupTint(key)
        : projectGroupTint(projectGroupKey(p.folderName))
      const last = result[result.length - 1]
      if (last && last.key === key) {
        last.items.push(p)
      } else {
        result.push({ key, tint, items: [p] })
      }
    }
    return result
  }, [filtered, searching])

  // When workspace finishes loading (or selection changes), scroll active item into view.
  useEffect(() => {
    if (loading || searchScanning || !selected) return
    const inList = filtered.some((p) => p.path === selected.path)
    if (!inList) return
    const el = itemRefs.current.get(selected.path)
    if (!el) return
    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 40)
    return () => window.clearTimeout(t)
  }, [activeWorkspace, loading, searchScanning, selected?.path, filtered])

  const canLocate =
    !!selected &&
    !(searching ? searchScanning : loading) &&
    filtered.some((p) => p.path === selected.path)

  const locateSelected = () => {
    if (!selected) return
    const el = itemRefs.current.get(selected.path)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const openProject = (p: ListedProject, opts?: { clearSearch?: boolean }) => {
    const clearSearch = opts?.clearSearch !== false
    const ws =
      p.workspace ||
      findWorkspaceForPath(p.path, workspaces) ||
      activeWorkspace
    // Switch workspace first (cache avoids empty flash), then clear search
    if (ws && ws !== activeWorkspace) {
      setActiveWorkspace(ws)
    }
    void selectProject(p)
    if (clearSearch && q) {
      void touchSearchHistory(p.folderName)
      setSearch('')
    }
  }

  const showBrowseLoading = !searching && loading
  const title = searching ? t('projects.searchTitle') : t('projects.title')

  return (
    <aside className={`list-pane ${searching ? 'is-searching' : ''}`}>
      <div className="pane-title-row">
        <div className="pane-title">
          {title} <span className="muted">({filtered.length})</span>
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
        {showBrowseLoading && <div className="empty">{t('projects.scanning')}</div>}
        {searching && searchScanning && (
          <div className="search-scan-hint muted">{t('projects.searchScanning')}</div>
        )}
        {error && !searching && (
          <div className="empty" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        )}
        {!showBrowseLoading &&
          groups.map((g) => (
            <div
              key={g.key}
              className="project-group"
              style={{ ['--project-group-bg' as string]: g.tint }}
            >
              <div className="project-group-mark" aria-hidden>
                {searching ? t('projects.workspaceGroup', { name: g.key }) : g.key}
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
                  title={searching ? p.path : undefined}
                  onClick={() => openProject(p)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openProject(p, { clearSearch: false })
                    setMenu({ path: p.path, x: e.clientX, y: e.clientY })
                  }}
                >
                  <span className="project-capsule-name">{p.folderName}</span>
                  <span className="project-capsule-meta muted">
                    {searching && (
                      <>
                        <span className="project-ws-tag">
                          {shortWorkspaceName(p.workspace)}
                        </span>
                        {' · '}
                      </>
                    )}
                    {projectSubtitle(p)}
                    {p.frameworks.length > 0 ? ` · ${p.frameworks.join(',')}` : ''}
                  </span>
                </button>
              ))}
            </div>
          ))}
        {!showBrowseLoading && !error && filtered.length === 0 && (
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
