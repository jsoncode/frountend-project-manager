import {
  ChevronDown,
  ChevronRight,
  Document,
  Folder2,
  Refresh,
  Trash,
} from 'reicon-react'
import { invoke } from '@tauri-apps/api/core'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useI18n } from '../i18n/useI18n'
import {
  normalizeFsPath,
  toProjectRelative,
} from '../lib/gitDecorations'
import { projectMatchesQuery, projectSubtitle } from '../lib/projectSearch'
import type { ProjectSummary } from '../lib/types'
import {
  findWorkspaceForPath,
  shortWorkspaceName,
} from '../lib/workspacePath'
import { useExplorerStore } from '../stores/explorerStore'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { ContextMenuPortal } from './ContextMenuPortal'
import { ModalShell } from './ModalShell'
import { OpenWithMenu } from './OpenWithMenu'
import { Tooltip } from './Tooltip'

type DirEntry = {
  name: string
  path: string
  isDir: boolean
}

type MenuState =
  | { kind: 'workspace'; path: string; x: number; y: number }
  | { kind: 'project'; path: string; x: number; y: number }
  | { kind: 'entry'; path: string; x: number; y: number }

function sortProjects(list: ProjectSummary[]) {
  return [...list].sort((a, b) =>
    a.folderName.localeCompare(b.folderName, undefined, {
      sensitivity: 'base',
    }),
  )
}

export function Explorer() {
  const config = useSettingsStore((s) => s.config)
  const saveWorkspaces = useSettingsStore((s) => s.saveWorkspaces)
  const workspaces = config?.workspaces ?? []

  const projectCache = useWorkspaceStore((s) => s.projectCache)
  const error = useWorkspaceStore((s) => s.error)
  const search = useWorkspaceStore((s) => s.search)
  const setSearch = useWorkspaceStore((s) => s.setSearch)
  const searchScanning = useWorkspaceStore((s) => s.searchScanning)
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace)
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace)
  const refreshWorkspace = useWorkspaceStore((s) => s.refreshWorkspace)
  const dropWorkspaceCache = useWorkspaceStore((s) => s.dropWorkspaceCache)
  const touchSearchHistory = useSettingsStore((s) => s.touchSearchHistory)

  const selectedProject = useProjectStore((s) => s.selected)
  const selectProject = useProjectStore((s) => s.selectProject)
  const gitDecorations = useProjectStore((s) => s.gitDecorations)

  const selection = useExplorerStore((s) => s.selection)
  const setSelection = useExplorerStore((s) => s.setSelection)

  const { t } = useI18n()

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [dirCache, setDirCache] = useState<Record<string, DirEntry[]>>({})
  const [dirLoading, setDirLoading] = useState<Set<string>>(() => new Set())
  const dirCacheRef = useRef<Record<string, DirEntry[]>>({})
  const dirInflight = useRef(new Set<string>())
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())

  const q = search.trim()
  const searching = q.length > 0

  /** Keep only directory expands (multi-open allowed). */
  const keepDirExpands = (prev: Set<string>) => {
    const next = new Set<string>()
    for (const id of prev) {
      if (id.startsWith('dir:')) next.add(id)
    }
    return next
  }

  /** Accordion: at most one workspace expanded. */
  const expandOnlyWorkspace = useCallback((ws: string) => {
    const wsId = `ws:${ws}`
    setExpanded((prev) => {
      const next = keepDirExpands(prev)
      next.add(wsId)
      return next
    })
  }, [])

  /** Accordion: at most one workspace + one project expanded. */
  const expandOnlyProject = useCallback((workspace: string, projectPath: string) => {
    setExpanded((prev) => {
      const next = keepDirExpands(prev)
      next.add(`ws:${workspace}`)
      next.add(`proj:${projectPath}`)
      return next
    })
  }, [])

  const toggleDirExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const loadDir = useCallback(async (path: string, force = false) => {
    if (!force && dirCacheRef.current[path] !== undefined) return
    if (dirInflight.current.has(path)) return
    dirInflight.current.add(path)
    setDirLoading((prev) => new Set(prev).add(path))
    try {
      const entries = await invoke<DirEntry[]>('list_directory_entries', {
        path,
      })
      dirCacheRef.current[path] = entries
      setDirCache((prev) => ({ ...prev, [path]: entries }))
    } catch {
      dirCacheRef.current[path] = []
      setDirCache((prev) => ({ ...prev, [path]: [] }))
    } finally {
      dirInflight.current.delete(path)
      setDirLoading((prev) => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }
  }, [])

  useEffect(() => {
    if (!activeWorkspace || searching) return
    expandOnlyWorkspace(activeWorkspace)
  }, [activeWorkspace, searching, expandOnlyWorkspace])

  useEffect(() => {
    if (!searching) return
    // Search may surface matches across workspaces — expand all hits.
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const ws of workspaces) {
        const list = projectCache[ws] ?? []
        if (list.some((p) => projectMatchesQuery(p, q))) {
          next.add(`ws:${ws}`)
        }
      }
      return next
    })
  }, [searching, q, workspaces, projectCache])

  const confirmRemove = async () => {
    if (!config || !pendingRemove) return
    const path = pendingRemove
    const next = config.workspaces.filter((w) => w !== path)
    await saveWorkspaces(next)
    dropWorkspaceCache(path)
    if (activeWorkspace === path) {
      setActiveWorkspace(next[0] ?? null)
    }
    setPendingRemove(null)
  }

  const selectProjectRow = (p: ProjectSummary, workspace: string) => {
    const fromSearch = searching
    if (workspace && workspace !== activeWorkspace) {
      setActiveWorkspace(workspace)
    }
    void selectProject(p)
    setSelection({ kind: 'project', path: p.path, workspace })
    if (fromSearch) {
      void touchSearchHistory(p.folderName)
      setSearch('')
      window.setTimeout(() => {
        const el = rowRefs.current.get(`proj:${p.path}`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
  }

  /** Select + expand (e.g. context menu). */
  const openProject = (p: ProjectSummary, workspace: string) => {
    selectProjectRow(p, workspace)
    expandOnlyProject(workspace, p.path)
    void loadDir(p.path, true)
  }

  const onToggleWorkspace = (ws: string) => {
    const id = `ws:${ws}`
    const willOpen = !expanded.has(id)
    if (willOpen) {
      expandOnlyWorkspace(ws)
    } else {
      setExpanded((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
    setActiveWorkspace(ws)
    setSelection({ kind: 'workspace', path: ws })
    void refreshWorkspace(ws)
  }

  const onToggleProject = (p: ProjectSummary, workspace: string) => {
    const id = `proj:${p.path}`
    const willOpen = !expanded.has(id)
    const fromSearch = searching
    if (workspace && workspace !== activeWorkspace) {
      setActiveWorkspace(workspace)
    }
    void selectProject(p)
    setSelection({ kind: 'project', path: p.path, workspace })
    if (fromSearch) {
      void touchSearchHistory(p.folderName)
      setSearch('')
      window.setTimeout(() => {
        const el = rowRefs.current.get(`proj:${p.path}`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
    if (willOpen) {
      expandOnlyProject(workspace, p.path)
      void loadDir(p.path, true)
    } else if (!fromSearch) {
      setExpanded((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    } else {
      expandOnlyProject(workspace, p.path)
      void loadDir(p.path, true)
    }
  }

  const findProject = (projectPath: string): ProjectSummary | null => {
    for (const list of Object.values(projectCache)) {
      const hit = list.find((p) => p.path === projectPath)
      if (hit) return hit
    }
    return selectedProject?.path === projectPath ? selectedProject : null
  }

  const ensureProjectContext = (projectPath: string) => {
    const owner =
      selectedProject?.path === projectPath
        ? selectedProject
        : findProject(projectPath)
    if (!owner) return
    const ws =
      findWorkspaceForPath(owner.path, workspaces) || activeWorkspace || ''
    if (ws && ws !== activeWorkspace) setActiveWorkspace(ws)
    if (selectedProject?.path !== owner.path) void selectProject(owner)
  }

  const onToggleDir = (
    entry: DirEntry,
    projectPath: string,
    e?: MouseEvent,
  ) => {
    e?.stopPropagation()
    const id = `dir:${entry.path}`
    const willOpen = !expanded.has(id)
    toggleDirExpanded(id)
    setSelection({ kind: 'dir', path: entry.path, projectPath })
    ensureProjectContext(projectPath)
    if (willOpen) void loadDir(entry.path, true)
  }

  const onSelectFile = (entry: DirEntry, projectPath: string) => {
    setSelection({ kind: 'file', path: entry.path, projectPath })
    const owner = findProject(projectPath)
    if (owner) {
      const ws =
        findWorkspaceForPath(owner.path, workspaces) ||
        activeWorkspace ||
        ''
      if (ws && ws !== activeWorkspace) setActiveWorkspace(ws)
      if (selectedProject?.path !== owner.path) void selectProject(owner)
    }
  }

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path)
    } catch {
      /* ignore */
    }
    setMenu(null)
  }

  const revealPath = async (path: string) => {
    try {
      await invoke('reveal_in_file_manager', { path })
    } catch {
      /* ignore */
    }
    setMenu(null)
  }

  const isSelected = (kind: string, path: string) => {
    if (!selection) return false
    return selection.kind === kind && selection.path === path
  }

  const renderEntries = (
    parentPath: string,
    projectPath: string,
    depth: number,
  ): ReactNode => {
    const entries = dirCache[parentPath]
    if (dirLoading.has(parentPath) && !entries) {
      return (
        <div
          className="explorer-row muted"
          style={{ paddingLeft: 8 + depth * 10 }}
        >
          {t('explorer.loading')}
        </div>
      )
    }
    if (!entries || entries.length === 0) {
      return (
        <div
          className="explorer-row muted"
          style={{ paddingLeft: 8 + depth * 10 }}
        >
          {t('explorer.emptyDir')}
        </div>
      )
    }
    return entries.map((entry) => {
      const sameProject =
        selectedProject != null &&
        normalizeFsPath(selectedProject.path) === normalizeFsPath(projectPath)
      const rel = sameProject
        ? toProjectRelative(entry.path, projectPath)
        : null
      if (entry.isDir) {
        const id = `dir:${entry.path}`
        const open = expanded.has(id)
        const dirChangeCount = rel != null ? (gitDecorations.dirs[rel] ?? 0) : 0
        const dirDirty = dirChangeCount > 0
        return (
          <div key={entry.path}>
            <Tooltip title={entry.path} placement="right">
              <button
                type="button"
                className={`explorer-row explorer-dir-row ${isSelected('dir', entry.path) ? 'active' : ''}${dirDirty ? ' git-changed' : ''}`}
                style={{ paddingLeft: 10 + depth * 10 }}
                onClick={(e) => onToggleDir(entry, projectPath, e)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setSelection({
                    kind: 'dir',
                    path: entry.path,
                    projectPath,
                  })
                  setMenu({
                    kind: 'entry',
                    path: entry.path,
                    x: e.clientX,
                    y: e.clientY,
                  })
                }}
              >
              <span
                className="explorer-twist"
                onClick={(e) => onToggleDir(entry, projectPath, e)}
                onDoubleClick={(e) => e.stopPropagation()}
                aria-hidden
              >
                {open ? (
                  <ChevronDown size={12} color="currentColor" />
                ) : (
                  <ChevronRight size={12} color="currentColor" />
                )}
              </span>
              <Folder2
                className="explorer-icon"
                size={14}
                color="currentColor"
                weight={open ? 'Filled' : 'Outline'}
                aria-hidden
              />
              <span className="explorer-label">{entry.name}</span>
              {dirDirty ? (
                <span className="git-dir-count" aria-hidden>{dirChangeCount}</span>
              ) : null}
            </button>
            </Tooltip>
            {open ? renderEntries(entry.path, projectPath, depth + 1) : null}
          </div>
        )
      }
      const gitMark =
        rel != null ? gitDecorations.files[rel] ?? null : null
      return (
        <Tooltip key={entry.path} title={entry.path} placement="right">
          <button
            type="button"
            className={`explorer-row explorer-file-row ${isSelected('file', entry.path) ? 'active' : ''}${gitMark ? ' git-changed' : ''}`}
            style={{ paddingLeft: 10 + depth * 10 }}
            onClick={() => onSelectFile(entry, projectPath)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setSelection({
                kind: 'file',
                path: entry.path,
                projectPath,
              })
              setMenu({
                kind: 'entry',
                path: entry.path,
                x: e.clientX,
                y: e.clientY,
              })
            }}
          >
          <span className="explorer-twist" aria-hidden />
          <Document
            className="explorer-icon"
            size={14}
            color="currentColor"
            aria-hidden
          />
          <span className="explorer-label">{entry.name}</span>
          {gitMark ? (
            <span className={`git-file-mark git-mark-${gitMark}`}>
              {gitMark}
            </span>
          ) : null}
        </button>
        </Tooltip>
      )
    })
  }

  return (
    <div className="explorer">
      <div className="scroll explorer-scroll">
        {error && (
          <div className="empty" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        )}
        {workspaces.length === 0 && (
          <div className="empty">{t('ws.empty')}</div>
        )}
        {searching &&
          searchScanning &&
          workspaces.every((ws) => !(projectCache[ws]?.length)) && (
            <div className="empty muted">{t('search.scanning')}</div>
          )}
        {searching &&
          !searchScanning &&
          workspaces.every(
            (ws) =>
              !(projectCache[ws] ?? []).some((p) => projectMatchesQuery(p, q)),
          ) && (
            <div className="empty">{t('search.empty')}</div>
          )}

        {workspaces.map((ws) => {
          const wsId = `ws:${ws}`
          const allProjects = sortProjects(projectCache[ws] ?? [])
          const projects = searching
            ? allProjects.filter((p) => projectMatchesQuery(p, q))
            : allProjects
          if (searching && projects.length === 0) return null
          const wsOpen = searching || expanded.has(wsId)
          const wsActive =
            isSelected('workspace', ws) ||
            (!selection && activeWorkspace === ws)

          return (
            <div key={ws} className="explorer-ws">
              <Tooltip title={ws} placement="right">
                <button
                  type="button"
                  className={`explorer-row explorer-ws-row ${wsActive ? 'active' : ''}`}
                  style={{ paddingLeft: 10 }}
                  onClick={() => onToggleWorkspace(ws)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setMenu({
                      kind: 'workspace',
                      path: ws,
                      x: e.clientX,
                      y: e.clientY,
                    })
                  }}
                >
                <span
                  className="explorer-twist"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleWorkspace(ws)
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  aria-hidden
                >
                  {wsOpen ? (
                    <ChevronDown size={12} color="currentColor" />
                  ) : (
                    <ChevronRight size={12} color="currentColor" />
                  )}
                </span>
                <Folder2
                  className="explorer-icon"
                  size={15}
                  color="currentColor"
                  weight="Filled"
                  aria-hidden
                />
                <span className="explorer-label">
                  {shortWorkspaceName(ws)}
                </span>
              </button>
              </Tooltip>

              {wsOpen &&
                projects.map((p) => {
                  const projId = `proj:${p.path}`
                  const projOpen = expanded.has(projId)
                  const projActive =
                    isSelected('project', p.path) ||
                    selectedProject?.path === p.path
                  const projGitDirty =
                    selectedProject != null &&
                    normalizeFsPath(selectedProject.path) ===
                      normalizeFsPath(p.path) &&
                    (gitDecorations.dirs[''] ?? 0) > 0
                  const projChangeCount =
                    selectedProject != null &&
                    normalizeFsPath(selectedProject.path) ===
                      normalizeFsPath(p.path)
                      ? (gitDecorations.dirs[''] ?? 0)
                      : 0

                  return (
                    <div key={p.path}>
                      <Tooltip title={`${p.path}\n${projectSubtitle(p)}`} placement="right">
                        <button
                          type="button"
                          ref={(node) => {
                            if (node) rowRefs.current.set(projId, node)
                            else rowRefs.current.delete(projId)
                          }}
                          className={`explorer-row explorer-project-row ${projActive ? 'active' : ''}${projGitDirty ? ' git-changed' : ''}`}
                          style={{ paddingLeft: 20 }}
                          onClick={() => onToggleProject(p, ws)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            openProject(p, ws)
                            setMenu({
                              kind: 'project',
                              path: p.path,
                              x: e.clientX,
                              y: e.clientY,
                            })
                          }}
                        >
                        <span
                          className="explorer-twist"
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleProject(p, ws)
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                          aria-hidden
                        >
                          {projOpen ? (
                            <ChevronDown size={12} color="currentColor" />
                          ) : (
                            <ChevronRight size={12} color="currentColor" />
                          )}
                        </span>
                        <Folder2
                          className="explorer-icon"
                          size={14}
                          color="currentColor"
                          weight={projOpen ? 'Filled' : 'Outline'}
                          aria-hidden
                        />
                        <span className="explorer-label">{p.folderName}</span>
                        {projGitDirty ? (
                          <span className="git-dir-count" aria-hidden>{projChangeCount}</span>
                        ) : null}
                      </button>
                      </Tooltip>
                      {projOpen ? renderEntries(p.path, p.path, 2) : null}
                    </div>
                  )
                })}

              {wsOpen && projectCache[ws] === undefined && (
                <div
                  className="explorer-row muted"
                  style={{ paddingLeft: 20 }}
                >
                  {t('projects.scanning')}
                </div>
              )}

              {wsOpen &&
                projectCache[ws] !== undefined &&
                projects.length === 0 && (
                  <div
                    className="explorer-row muted"
                    style={{ paddingLeft: 20 }}
                  >
                    {t('explorer.noProjects')}
                  </div>
                )}
            </div>
          )
        })}
      </div>

      {menu?.kind === 'workspace' && (
        <OpenWithMenu
          path={menu.path}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        >
          <button
            type="button"
            role="menuitem"
            className="btn-with-icon"
            onClick={() => {
              void refreshWorkspace(menu.path)
              setMenu(null)
            }}
          >
            <Refresh className="ui-icon" size={14} color="currentColor" aria-hidden />
            {t('ws.refresh')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="btn-with-icon"
            onClick={() => {
              setPendingRemove(menu.path)
              setMenu(null)
            }}
          >
            <Trash className="ui-icon" size={14} color="currentColor" aria-hidden />
            {t('ws.remove')}
          </button>
        </OpenWithMenu>
      )}

      {menu?.kind === 'project' && (
        <OpenWithMenu
          path={menu.path}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}

      {menu?.kind === 'entry' && (
        <ContextMenuPortal
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => void copyPath(menu.path)}
          >
            {t('explorer.copyPath')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void revealPath(menu.path)}
          >
            {t('open.inFileManager')}
          </button>
        </ContextMenuPortal>
      )}

      {pendingRemove && (
        <ModalShell
          title={t('ws.removeTitle')}
          onClose={() => setPendingRemove(null)}
          closeOnEsc={false}
        >
          <p className="muted">
            {t('ws.removeConfirm', {
              name: shortWorkspaceName(pendingRemove),
            })}
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setPendingRemove(null)}
            >
              {t('branch.cancel')}
            </button>
            <button
              type="button"
              className="btn danger btn-with-icon"
              onClick={() => void confirmRemove()}
            >
              <Trash className="ui-icon" size={14} color="currentColor" aria-hidden />
              {t('ws.remove')}
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  )
}
