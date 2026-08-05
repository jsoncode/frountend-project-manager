import {
  ArrowDown,
  ArrowSwapHorizontal,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Document,
  Folder2,
  Pen,
  Refresh,
  Trash,
} from 'reicon-react'
import { invoke } from '@tauri-apps/api/core'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useI18n } from '../i18n/useI18n'
import {
  normalizeFsPath,
  toProjectRelative,
  unquoteGitPath,
} from '../lib/gitDecorations'
import { projectMatchesQuery } from '../lib/projectSearch'
import type { ProjectSummary } from '../lib/types'
import {
  findWorkspaceForPath,
  shortWorkspaceName,
} from '../lib/workspacePath'
import { useExplorerStore } from '../stores/explorerStore'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { CommitModal } from './CommitModal'
import { ContextMenuPortal } from './ContextMenuPortal'
import { FileDiffModal } from './FileDiffModal'
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
  | { kind: 'entry'; path: string; projectPath: string; isDir: boolean; x: number; y: number }

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
  const projectStatuses = useWorkspaceStore((s) => s.projectStatuses)
  const scanningStatuses = useWorkspaceStore((s) => s.scanningStatuses)
  const scanAllProjectStatuses = useWorkspaceStore((s) => s.scanAllProjectStatuses)
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
  const expanded = useExplorerStore((s) => s.expanded)
  const setExpanded = useExplorerStore((s) => s.setExpanded)
  const toggleExpanded = useExplorerStore((s) => s.toggleExpanded)

  const { t } = useI18n()

  const [dirCache, setDirCache] = useState<Record<string, DirEntry[]>>({})
  const [dirLoading, setDirLoading] = useState<Set<string>>(() => new Set())
  const dirCacheRef = useRef<Record<string, DirEntry[]>>({})
  const dirInflight = useRef(new Set<string>())
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [commitEntry, setCommitEntry] = useState<{ path: string; projectPath: string } | null>(null)
  const [diffFile, setDiffFile] = useState<{ filePath: string; projectPath: string; compareFilePath?: string } | null>(null)
  const [diffDirList, setDiffDirList] = useState<{ dirPath: string; projectPath: string; files: { absPath: string; relPath: string; label: string }[] } | null>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())

  // Debounce click vs dblclick for workspace/project/dir toggle
  const toggleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const togglePathRef = useRef('')

  const debouncedToggle = useCallback((id: string, action: () => void) => {
    if (toggleTimerRef.current) clearTimeout(toggleTimerRef.current)
    if (togglePathRef.current === id) {
      togglePathRef.current = ''
      return
    }
    togglePathRef.current = id
    toggleTimerRef.current = setTimeout(() => {
      toggleTimerRef.current = null
      togglePathRef.current = ''
      action()
    }, 250)
  }, [])

  const q = search.trim()
  const searching = q.length > 0

  /** Keep only directory expands (multi-open allowed). */
  const keepDirExpands = (prev: string[]) => prev.filter((id) => id.startsWith('dir:'))

  /** Accordion: at most one workspace expanded. */
  const expandOnlyWorkspace = useCallback((ws: string) => {
    const wsId = `ws:${ws}`
    setExpanded((prev: string[]) => {
      const next = keepDirExpands(prev)
      if (!next.includes(wsId)) next.push(wsId)
      return next
    })
  }, [setExpanded])

  /** Accordion: at most one workspace + one project expanded. */
  const expandOnlyProject = useCallback((workspace: string, projectPath: string) => {
    setExpanded((prev: string[]) => {
      const next = keepDirExpands(prev)
      const wsId = `ws:${workspace}`
      const projId = `proj:${projectPath}`
      if (!next.includes(wsId)) next.push(wsId)
      if (!next.includes(projId)) next.push(projId)
      return next
    })
  }, [setExpanded])

  const toggleDirExpanded = useCallback((id: string) => {
    toggleExpanded(id)
  }, [toggleExpanded])

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

  // Track expanded in a ref so the auto-expand effect doesn't re-fire on every collapse.
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  useEffect(() => {
    if (!activeWorkspace || searching) return
    // Only auto-expand if not already expanded
    if (!expandedRef.current.includes(`ws:${activeWorkspace}`)) {
      expandOnlyWorkspace(activeWorkspace)
    }
  }, [activeWorkspace, searching, expandOnlyWorkspace])

  useEffect(() => {
    if (!searching) return
    // Search may surface matches across workspaces — expand all hits.
    setExpanded((prev: string[]) => {
      const next = [...prev]
      for (const ws of workspaces) {
        const list = projectCache[ws] ?? []
        if (list.some((p) => projectMatchesQuery(p, q))) {
          const wsId = `ws:${ws}`
          if (!next.includes(wsId)) next.push(wsId)
        }
      }
      return next
    })
  }, [searching, q, workspaces, projectCache, setExpanded])

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

  const onToggleWorkspace = (ws: string) => {
    setMenu(null)
    const id = `ws:${ws}`
    const willOpen = !expanded.includes(id)
    if (willOpen) {
      expandOnlyWorkspace(ws)
    } else {
      setExpanded((prev: string[]) => prev.filter((x) => x !== id))
    }
    setActiveWorkspace(ws)
    setSelection({ kind: 'workspace', path: ws })
    void refreshWorkspace(ws)
  }

  const onToggleProject = (p: ProjectSummary, workspace: string) => {
    setMenu(null)
    const id = `proj:${p.path}`
    const willOpen = !expanded.includes(id)
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
      setExpanded((prev: string[]) => prev.filter((x) => x !== id))
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

  const onSelectFile = (entry: DirEntry, projectPath: string) => {
    setMenu(null)

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

  /** Find the folder name for a project path (for CommitModal). */
  const findProjectName = (projectPath: string): string => {
    for (const list of Object.values(projectCache)) {
      const hit = list.find((p) => p.path === projectPath)
      if (hit) return hit.folderName
    }
    return projectPath
  }

  const isSelected = (kind: string, path: string) => {
    if (!selection) return false
    return selection.kind === kind && selection.path === path
  }

  const isContextTarget = (path: string) => menu?.path === path

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
        const open = expanded.includes(id)
        const dirChangeCount = rel != null ? (gitDecorations.dirs[rel] ?? 0) : 0
        const dirDirty = dirChangeCount > 0
        return (
          <div key={entry.path}>
            <Tooltip title={entry.path} placement="right">
              <button
                type="button"
                className={`explorer-row explorer-dir-row ${isSelected('dir', entry.path) ? 'active' : ''}${dirDirty ? ' git-changed' : ''}${isContextTarget(entry.path) ? ' context-target' : ''}`}
                style={{ paddingLeft: 10 + depth * 10 }}
                onClick={(e) => {
                  if (e.button !== 0) return
                  setMenu(null)
                  debouncedToggle(`dir:${entry.path}`, () => {
                    const id = `dir:${entry.path}`
                    const willOpen = !expanded.includes(id)
                    toggleDirExpanded(id)
                    setSelection({ kind: 'dir', path: entry.path, projectPath })
                    ensureProjectContext(projectPath)
                    if (willOpen) void loadDir(entry.path, true)
                  })
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setMenu({
                    kind: 'entry',
                    path: entry.path,
                    projectPath,
                    isDir: true,
                    x: e.clientX,
                    y: e.clientY,
                  })
                }}
              >
              <span
                className="explorer-twist"
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
            className={`explorer-row explorer-file-row ${isSelected('file', entry.path) ? 'active' : ''}${gitMark ? ' git-changed' : ''}${isContextTarget(entry.path) ? ' context-target' : ''}`}
            style={{ paddingLeft: 10 + depth * 10 }}
            onClick={(e) => { if (e.button === 0) onSelectFile(entry, projectPath) }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu({
                kind: 'entry',
                path: entry.path,
                projectPath,
                isDir: false,
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
          const wsOpen = searching || expanded.includes(wsId)
          const wsActive =
            isSelected('workspace', ws) ||
            (!selection && activeWorkspace === ws)

          return (
            <div key={ws} className="explorer-ws">
              <button
                  type="button"
                  className={`explorer-row explorer-ws-row ${wsActive ? 'active' : ''}${isContextTarget(ws) ? ' context-target' : ''}`}
                  style={{ paddingLeft: 10 }}
                  onClick={(e) => {
                    if (e.button !== 0) return
                    debouncedToggle(`ws:${ws}`, () => onToggleWorkspace(ws))
                  }}
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

              {wsOpen &&
                projects.map((p) => {
                  const projId = `proj:${p.path}`
                  const projOpen = expanded.includes(projId)
                  const projActive =
                    isSelected('project', p.path) ||
                    selectedProject?.path === p.path
                  // Use projectStatuses for all projects (not just selected)
                  const statusSummary = projectStatuses[p.path]
                  // Fall back to gitDecorations for the selected project if no status summary
                  const isSelectedProject = selectedProject != null &&
                    normalizeFsPath(selectedProject.path) === normalizeFsPath(p.path)
                  const changedFiles = statusSummary?.changedFiles ??
                    (isSelectedProject ? (gitDecorations.dirs[''] ?? 0) : 0)
                  const behind = statusSummary?.behind ?? 0
                  const projGitDirty = changedFiles > 0

                  return (
                    <div key={p.path}>
                      <button
                          type="button"
                          ref={(node) => {
                            if (node) rowRefs.current.set(projId, node)
                            else rowRefs.current.delete(projId)
                          }}
                          className={`explorer-row explorer-project-row ${projActive ? 'active' : ''}${projGitDirty ? ' git-changed' : ''}${isContextTarget(p.path) ? ' context-target' : ''}`}
                          style={{ paddingLeft: 20 }}
                          onClick={(e) => {
                            if (e.button !== 0) return
                            debouncedToggle(`proj:${p.path}`, () => onToggleProject(p, ws))
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
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
                        {changedFiles > 0 ? (
                          <span className="proj-status-badge proj-status-changed" title={`${changedFiles} changed files`}>
                            <ArrowUp className="ui-icon" size={10} color="currentColor" aria-hidden />
                            {changedFiles}
                          </span>
                        ) : null}
                        {behind > 0 ? (
                          <span className="proj-status-badge proj-status-behind" title={`${behind} commits behind`}>
                            <ArrowDown className="ui-icon" size={10} color="currentColor" aria-hidden />
                            {behind}
                          </span>
                        ) : null}
                      </button>
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
            disabled={scanningStatuses}
            onClick={() => {
              void scanAllProjectStatuses(menu.path)
              setMenu(null)
            }}
          >
            <Refresh className={`ui-icon${scanningStatuses ? ' is-spinning' : ''}`} size={14} color="currentColor" aria-hidden />
            {scanningStatuses ? t('ws.scanningStatuses') : t('ws.checkAllStatus')}
          </button>
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
        >
          <button
            type="button"
            role="menuitem"
            className="btn-with-icon"
            onClick={() => {
              setCommitEntry({ path: menu.path, projectPath: menu.path })
              setMenu(null)
            }}
          >
            <Pen className="ui-icon" size={14} color="currentColor" aria-hidden />
            {t('explorer.commitChanges')}
          </button>
        </OpenWithMenu>
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
          <div className="branch-menu-sep" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setCommitEntry({ path: menu.path, projectPath: menu.projectPath })
              setMenu(null)
            }}
          >
            {t('explorer.commitChanges')}
          </button>
          <div className="branch-menu-sep" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(null)
              if (menu.isDir) {
                // Directory: collect changed files within this dir
                const dirRel = normalizeFsPath(toProjectRelative(menu.path, menu.projectPath) ?? '')
                const gs = useProjectStore.getState().gitStatus
                const entries = gs?.entries ?? []
                const files = entries
                  .map((e) => {
                    const rel = unquoteGitPath(e.path).replace(/^\/+/, '')
                    return { rel, label: e.label, absPath: menu.projectPath + '/' + rel }
                  })
                  .filter((f) => dirRel === '' || f.rel.startsWith(dirRel + '/') || f.rel === dirRel)
                  .map((f) => ({ absPath: f.absPath, relPath: f.rel, label: f.label }))
                setDiffDirList({ dirPath: menu.path, projectPath: menu.projectPath, files })
              } else {
                // File: open diff directly
                setDiffFile({ filePath: menu.path, projectPath: menu.projectPath })
              }
            }}
          >
            {t('explorer.viewChanges')}
          </button>
          {!menu.isDir && (
            <>
              <div className="branch-menu-sep" />
              <button
                type="button"
                role="menuitem"
                className="btn-with-icon"
                onClick={async () => {
                  setMenu(null)
                  try {
                    // Get the parent directory of the current file
                    const filePath = menu.path
                    const lastSlash = filePath.lastIndexOf('/')
                    const dir = lastSlash > 0 ? filePath.slice(0, lastSlash) : filePath
                    const picked = await invoke<string | null>('pick_file_in_directory', { directory: dir })
                    if (!picked) return
                    if (picked === filePath) {
                      window.alert(t('explorer.compareSameFile'))
                      return
                    }
                    setDiffFile({ filePath, projectPath: menu.projectPath, compareFilePath: picked })
                  } catch {
                    /* cancelled */
                  }
                }}
              >
                <ArrowSwapHorizontal className="ui-icon" size={14} color="currentColor" aria-hidden />
                {t('explorer.compareWith')}
              </button>
            </>
          )}
        </ContextMenuPortal>
      )}

      {commitEntry && (
        <CommitModal
          projectPath={commitEntry.projectPath}
          projectName={findProjectName(commitEntry.projectPath)}
          branch={selectedProject?.path === commitEntry.projectPath ? (useProjectStore.getState().git?.current ?? 'HEAD') : 'HEAD'}
          paths={[commitEntry.path]}
          onClose={() => setCommitEntry(null)}
          onDone={() => {
            setCommitEntry(null)
            if (selectedProject) void useProjectStore.getState().refreshGitStatus()
          }}
        />
      )}

      {diffFile && (
        <FileDiffModal
          projectPath={diffFile.projectPath}
          filePath={diffFile.filePath}
          compareFilePath={diffFile.compareFilePath}
          onClose={() => setDiffFile(null)}
        />
      )}

      {diffDirList && (
        <ModalShell
          title={t('explorer.changedFiles', { count: diffDirList.files.length })}
          onClose={() => setDiffDirList(null)}
        >
          {diffDirList.files.length === 0 ? (
            <p className="muted">{t('explorer.noChanges')}</p>
          ) : (
            <div className="explorer-diff-list">
              {diffDirList.files.map((f) => (
                <button
                  key={f.absPath}
                  type="button"
                  className="explorer-diff-list-item"
                  onClick={() => {
                    setDiffFile({ filePath: f.absPath, projectPath: diffDirList.projectPath })
                    setDiffDirList(null)
                  }}
                >
                  <Document className="ui-icon" size={14} color="currentColor" aria-hidden />
                  <span className="explorer-diff-list-path" title={f.absPath}>{f.relPath}</span>
                  <span className="explorer-diff-list-label muted">{f.label}</span>
                </button>
              ))}
            </div>
          )}
        </ModalShell>
      )}

      {pendingRemove && (
        <ModalShell
          title={t('ws.removeTitle')}
          onClose={() => setPendingRemove(null)}
          closeOnEsc={false}
          footer={
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
          }
        >
          <p className="muted">
            {t('ws.removeConfirm', {
              name: shortWorkspaceName(pendingRemove),
            })}
          </p>
        </ModalShell>
      )}
    </div>
  )
}
