import {
  ArrowDown,
  ArrowRight,
  ArrowSwapHorizontal,
  ArrowUp,
  BranchDown,
  BranchUp,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Command,
  Document,
  Folder2,
  Loader,
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
import { maxBranchBehind } from '../lib/gitInfo'
import { projectMatchesQuery } from '../lib/projectSearch'
import type { GitInfo, GitStatus, MergeStatus, ProjectSummary, PullBranchResult } from '../lib/types'
import {
  findWorkspaceForPath,
  normalizePath,
  shortWorkspaceName,
} from '../lib/workspacePath'
import { editorPathKey, useEditorStore } from '../stores/editorStore'
import { useExplorerStore } from '../stores/explorerStore'
import { showErrorLog } from '../stores/errorLogStore'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTerminalStore } from '../stores/terminalStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { CommitModal } from './CommitModal'
import { ContextMenuPortal } from './ContextMenuPortal'
import { FileDiffModal } from './FileDiffModal'
import { FileIcon } from './FileIcon'
import { MergeConflictModal } from './MergeConflictModal'
import { ModalShell } from './ModalShell'
import { OpenWithMenu } from './OpenWithMenu'
import { RenameModal } from './RenameModal'
import { SubMenuItem } from './SubMenuItem'
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
  const scanningWorkspaces = useWorkspaceStore((s) => s.scanningWorkspaces)
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
  const [dirErrors, setDirErrors] = useState<Set<string>>(() => new Set())
  const dirCacheRef = useRef<Record<string, DirEntry[]>>({})
  const dirInflight = useRef(new Set<string>())
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [commitEntry, setCommitEntry] = useState<{ path: string; projectPath: string } | null>(null)
  const [diffFile, setDiffFile] = useState<{ filePath: string; projectPath: string; compareFilePath?: string } | null>(null)
  const [diffDirList, setDiffDirList] = useState<{ dirPath: string; projectPath: string; files: { absPath: string; relPath: string; label: string }[] } | null>(null)
  // Git info for project context menu
  const [projGitInfo, setProjGitInfo] = useState<{ path: string; info: GitInfo | null } | null>(null)
  const [branchSwitchTarget, setBranchSwitchTarget] = useState<{ projectPath: string; branch: string } | null>(null)
  // Merge conflicts produced by a context-menu pull (opens the 3-way tool).
  const [pullMerge, setPullMerge] = useState<{ projectPath: string; initial: MergeStatus | null } | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  // Projects whose "view status" (git status in terminal) is still running.
  const [statusChecking, setStatusChecking] = useState<Set<string>>(() => new Set())
  // Projects whose context-menu "update" (git_pull_all) is still running.
  const [pulling, setPulling] = useState<Set<string>>(() => new Set())
  // Projects with a context-menu git op (fetch / push / log / checkout) still running.
  const [gitOps, setGitOps] = useState<Set<string>>(() => new Set())
  // Pending rename / delete targets from the project & entry context menus.
  const [renameTarget, setRenameTarget] = useState<
    | { kind: 'project'; path: string; name: string }
    | { kind: 'entry'; path: string; projectPath: string; isDir: boolean }
    | null
  >(null)
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: 'project'; path: string; name: string }
    | { kind: 'entry'; path: string; isDir: boolean; name: string }
    | null
  >(null)
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
      setDirErrors((prev) => {
        if (!prev.has(path)) return prev
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    } catch {
      // Never cache a failure as an empty list — that would render a
      // misleading "empty folder" for a directory that actually has content.
      delete dirCacheRef.current[path]
      setDirCache((prev) => {
        if (!(path in prev)) return prev
        const next = { ...prev }
        delete next[path]
        return next
      })
      setDirErrors((prev) => new Set(prev).add(path))
    } finally {
      dirInflight.current.delete(path)
      setDirLoading((prev) => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }
  }, [])

  // Safety net: any expanded project/dir without a cache entry gets
  // (re)loaded. Covers expands that raced a previous failed load, and the
  // frame between expanding and the forced load marking itself loading.
  useEffect(() => {
    for (const id of expanded) {
      let path: string
      if (id.startsWith('dir:')) path = id.slice(4)
      else if (id.startsWith('proj:')) path = id.slice(5)
      else continue
      if (dirErrors.has(path)) continue
      if (dirCacheRef.current[path] === undefined && !dirInflight.current.has(path)) {
        void loadDir(path)
      }
    }
  }, [expanded, dirCache, dirErrors, loadDir])

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

  // ── Git helpers for project context menu ──
  const projGitCurrent = projGitInfo?.info?.current ?? undefined
  const projLocalName = (name: string) =>
    name.replace(/^remotes\//, '').replace(/^origin\//, '')

  const projRunGit = async (projectPath: string, command: string) => {
    const proj = findProject(projectPath)
    const name = proj?.folderName ?? projectPath.split('/').pop() ?? projectPath
    return useTerminalStore.getState().runRaw(projectPath, name, command)
  }

  /**
   * Run a context-menu git op while showing the project-row spinner;
   * the spinner always clears (success, error, or cancel).
   */
  const withGitOp = async (projectPath: string, op: () => Promise<void>) => {
    setGitOps((prev) => new Set(prev).add(projectPath))
    try {
      await op()
    } finally {
      setGitOps((prev) => {
        const next = new Set(prev)
        next.delete(projectPath)
        return next
      })
    }
  }

  // ── Filesystem helpers for project/entry context menus ──

  /** Close editor tabs whose path equals `prefix` or lives under it. */
  const closeTabsUnder = (prefix: string) => {
    const editor = useEditorStore.getState()
    const base = normalizeFsPath(prefix)
    for (const tab of [...editor.tabs]) {
      const key = editorPathKey(tab.path)
      if (key === base || key.startsWith(`${base}/`)) {
        editor.closeTab(tab.path)
      }
    }
  }

  /** Refuse to delete a configured workspace root itself. */
  const isWorkspaceRoot = (path: string) => {
    const norm = normalizePath(path).toLowerCase()
    return workspaces.some((w) => normalizePath(w).toLowerCase() === norm)
  }

  const parentDirOf = (path: string) => {
    const i = path.lastIndexOf('/')
    return i > 0 ? path.slice(0, i) : path
  }

  /** Rename a project folder; migrate cached git status, then rescan. */
  const renameProject = async (oldPath: string, newName: string): Promise<string | null> => {
    try {
      const newPath = await invoke<string>('rename_path', { path: oldPath, newName })
      const wsStore = useWorkspaceStore.getState()
      const status = wsStore.projectStatuses[oldPath]
      if (status) {
        wsStore.updateProjectStatus(newPath, status)
        useWorkspaceStore.setState((s) => {
          const projectStatuses = { ...s.projectStatuses }
          delete projectStatuses[oldPath]
          return { projectStatuses }
        })
      }
      const workspace = findWorkspaceForPath(oldPath, workspaces)
      if (workspace) await wsStore.refreshWorkspace(workspace)
      closeTabsUnder(oldPath)
      setRenameTarget(null)
      return null
    } catch (e) {
      return String(e)
    }
  }

  const deleteProject = async (path: string) => {
    try {
      await invoke('delete_path', { path })
    } catch (e) {
      showErrorLog(e, t('fs.opFailed'))
      return
    }
    useWorkspaceStore.setState((s) => {
      const projectStatuses = { ...s.projectStatuses }
      delete projectStatuses[path]
      return { projectStatuses }
    })
    closeTabsUnder(path)
    setExpanded((prev) =>
      prev.filter((id) => id !== `proj:${path}` && !id.startsWith(`dir:${path}/`)),
    )
    const workspace = findWorkspaceForPath(path, workspaces)
    if (workspace) await useWorkspaceStore.getState().refreshWorkspace(workspace)
  }

  /** Rename a file/dir; migrate tree cache + expansion for directories. */
  const renameEntry = async (oldPath: string, isDir: boolean, newName: string): Promise<string | null> => {
    try {
      const newPath = await invoke<string>('rename_path', { path: oldPath, newName })
      const parent = parentDirOf(oldPath)
      const patch = (cache: Record<string, DirEntry[]>) => {
        const list = cache[parent]
        if (!list) return cache
        return {
          ...cache,
          [parent]: list.map((e) =>
            e.path === oldPath ? { ...e, path: newPath, name: newName } : e,
          ),
        }
      }
      dirCacheRef.current = patch(dirCacheRef.current)
      setDirCache(patch)
      if (isDir) {
        const oldId = `dir:${oldPath}`
        const newId = `dir:${newPath}`
        setExpanded((prev) =>
          prev.map((id) => {
            if (id === oldId) return newId
            if (id.startsWith(`${oldId}/`)) return newId + id.slice(oldId.length)
            return id
          }),
        )
        const moved: Record<string, DirEntry[]> = {}
        for (const [k, v] of Object.entries(dirCacheRef.current)) {
          if (k === oldPath) moved[newPath] = v
          else if (k.startsWith(`${oldPath}/`)) moved[newPath + k.slice(oldPath.length)] = v
          else moved[k] = v
        }
        dirCacheRef.current = moved
        setDirCache(moved)
      }
      closeTabsUnder(oldPath)
      setRenameTarget(null)
      return null
    } catch (e) {
      return String(e)
    }
  }

  const deleteEntry = async (path: string, isDir: boolean) => {
    try {
      await invoke('delete_path', { path })
    } catch (e) {
      showErrorLog(e, t('fs.opFailed'))
      return
    }
    const parent = parentDirOf(path)
    const patch = (cache: Record<string, DirEntry[]>) => {
      const list = cache[parent]
      if (!list) return cache
      return { ...cache, [parent]: list.filter((e) => e.path !== path) }
    }
    dirCacheRef.current = patch(dirCacheRef.current)
    setDirCache(patch)
    if (isDir) {
      setExpanded((prev) =>
        prev.filter((id) => id !== `dir:${path}` && !id.startsWith(`dir:${path}/`)),
      )
    }
    closeTabsUnder(path)
  }

  // Checkout candidates for the project context-menu submenu.
  const projCheckoutLocals =
    projGitInfo?.info && projGitInfo.path === menu?.path
      ? projGitInfo.info.branches
          .filter((b) => !b.isRemote && b.name !== projGitCurrent)
          .slice(0, 10)
      : []
  const projCheckoutRemotes =
    projGitInfo?.info && projGitInfo.path === menu?.path
      ? projGitInfo.info.branches.filter((b) => b.isRemote).slice(0, 5)
      : []

  const fetchProjGitInfo = useCallback(async (projectPath: string) => {
    // First check workspaceStore cache (populated by scanAllProjectStatuses or selectProject)
    const cached = useWorkspaceStore.getState().projectStatuses[projectPath]
    if (cached?.gitInfo) {
      setProjGitInfo({ path: projectPath, info: cached.gitInfo })
      return
    }
    setGitLoading(true)
    try {
      const info = await invoke<GitInfo | null>('git_branches', { path: projectPath }).catch(() => null)
      setProjGitInfo({ path: projectPath, info })
      // Cache for next time
      if (info) {
        useWorkspaceStore.getState().updateProjectStatus(projectPath, {
          gitInfo: info,
          currentBranch: (info.current && info.current !== 'HEAD') ? info.current : undefined,
          behind: maxBranchBehind(info),
        })
      }
    } catch {
      setProjGitInfo({ path: projectPath, info: null })
    } finally {
      setGitLoading(false)
    }
  }, [])

  /**
   * Refresh git info after branch switch / pull / checkout and sync to
   * workspaceStore cache. These ops already have fresh refs locally, so the
   * network fetch is skipped.
   */
  const refreshProjGitAfterSwitch = async (projectPath: string) => {
    try {
      await useProjectStore
        .getState()
        .refreshProjectGitStatus(projectPath, { fetch: false })
      // Context menu reads gitInfo from local state — pick up the fresh one.
      const info =
        useWorkspaceStore.getState().projectStatuses[projectPath]?.gitInfo ??
        null
      setProjGitInfo({ path: projectPath, info })
    } catch {
      // ignore
    }
  }

  /**
   * On project expand: re-check the project's git state (fetch-first, best
   * effort) so the 待提交/待拉取 badges reflect the latest remote tips; the
   * row spinner shows while it runs.
   */
  const refreshExpandedGit = async (projectPath: string) => {
    setStatusChecking((prev) => new Set(prev).add(projectPath))
    try {
      await useProjectStore.getState().refreshProjectGitStatus(projectPath)
    } finally {
      setStatusChecking((prev) => {
        const next = new Set(prev)
        next.delete(projectPath)
        return next
      })
    }
  }

  const handleProjBranchSwitch = async (projectPath: string, branchName: string) => {
    setMenu(null)
    await withGitOp(projectPath, async () => {
      try {
        const s = await invoke<GitStatus>('git_status', { path: projectPath })
        if (s.clean) {
          await invoke<string>('git_checkout', { path: projectPath, branch: branchName })
          await useSettingsStore.getState().touchBranchHistory(projectPath, branchName)
          await refreshProjGitAfterSwitch(projectPath)
        } else {
          // Dirty working tree — hand over to the confirmation modal;
          // the actual checkout happens there (with its own spinner).
          setBranchSwitchTarget({ projectPath, branch: branchName })
        }
      } catch (e) {
        showErrorLog(e, t('error.gitFailed'))
      }
    })
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
    if (willOpen || fromSearch) {
      expandOnlyProject(workspace, p.path)
      void loadDir(p.path, true)
      // Fresh git status (fetch-first) so the badges show current
      // 待提交/待拉取 counts the moment the project is expanded.
      void refreshExpandedGit(p.path)
    } else {
      setExpanded((prev: string[]) => prev.filter((x) => x !== id))
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
    if (dirLoading.has(parentPath)) {
      return (
        <div
          className="explorer-row muted"
          style={{ paddingLeft: 8 + depth * 10 }}
        >
          {t('explorer.loading')}
        </div>
      )
    }
    if (!entries) {
      // undefined cache = never loaded successfully. A genuinely empty dir
      // is cached as [] and falls through to the emptyDir branch below.
      return (
        <div
          className="explorer-row muted"
          style={{ paddingLeft: 8 + depth * 10 }}
        >
          {dirErrors.has(parentPath)
            ? t('explorer.loadFailed')
            : t('explorer.loading')}
        </div>
      )
    }
    if (entries.length === 0) {
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
          <span className="explorer-icon">
            <FileIcon filename={entry.name} size={14} />
          </span>
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

              {wsOpen && scanningWorkspaces[ws] && scanningWorkspaces[ws].progress.total > 0 && (
                <div className="explorer-scan-progress" title={`${scanningWorkspaces[ws].progress.done}/${scanningWorkspaces[ws].progress.total}`}>
                  <div
                    className="explorer-scan-progress-bar"
                    style={{ width: `${(scanningWorkspaces[ws].progress.done / scanningWorkspaces[ws].progress.total) * 100}%` }}
                  />
                </div>
              )}

              {wsOpen &&
                projects.map((p) => {
                  const projId = `proj:${p.path}`
                  const projOpen = expanded.includes(projId)
                  const projActive =
                    isSelected('project', p.path) ||
                    selectedProject?.path === p.path
                  // Use projectStatuses for all projects (not just selected)
                  const statusSummary = projectStatuses[p.path]
                  const isSelectedProject = selectedProject != null &&
                    normalizeFsPath(selectedProject.path) === normalizeFsPath(p.path)
                  // For the selected project, prefer fresh gitDecorations from projectStore
                  // (just fetched) over the cached workspaceStore value which may be stale.
                  const changedFiles = isSelectedProject
                    ? (gitDecorations.dirs[''] ?? statusSummary?.changedFiles ?? 0)
                    : (statusSummary?.changedFiles ?? 0)
                  // Derive from the cached GitInfo snapshot (same data the
                  // branch panel renders) so both badges always agree; fall
                  // back to the persisted scalar for legacy entries.
                  const behind = statusSummary?.gitInfo
                    ? maxBranchBehind(statusSummary.gitInfo)
                    : (statusSummary?.behind ?? 0)
                  const currentBranch = statusSummary?.currentBranch
                  const projGitDirty = changedFiles > 0
                  const isScanning = scanningWorkspaces[ws]?.projects.has(p.path) ?? false

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
                            void fetchProjGitInfo(p.path)
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
                        {(isScanning || statusChecking.has(p.path) || pulling.has(p.path) || gitOps.has(p.path)) ? (
                          <Loader
                            className="explorer-icon ui-icon is-spinning"
                            size={14}
                            color="currentColor"
                            aria-hidden
                          />
                        ) : (
                          <Folder2
                            className="explorer-icon"
                            size={14}
                            color="currentColor"
                            weight={projOpen ? 'Filled' : 'Outline'}
                            aria-hidden
                          />
                        )}
                        <span className="explorer-label">{p.folderName}</span>
                        {currentBranch && (
                          <span className="proj-branch-label" title={currentBranch}>
                            <BranchUp className="ui-icon" size={11} color="currentColor" aria-hidden />
                            {currentBranch}
                          </span>
                        )}
                        {changedFiles > 0 ? (
                          <span className="proj-status-badge proj-status-changed" title={`${changedFiles} changed files`}>
                            <ArrowUp className="ui-icon" size={10} color="currentColor" aria-hidden />
                            {changedFiles}
                          </span>
                        ) : null}
                        {behind > 0 ? (
                          <span className="proj-status-badge proj-status-behind" title={t('explorer.behindHint', { n: behind })}>
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
            disabled={!!scanningWorkspaces[menu.path]}
            onClick={() => {
              void scanAllProjectStatuses(menu.path)
              setMenu(null)
            }}
          >
            {scanningWorkspaces[menu.path] ? (
              <Loader className="ui-icon is-spinning" size={14} color="currentColor" aria-hidden />
            ) : (
              <Refresh className="ui-icon" size={14} color="currentColor" aria-hidden />
            )}
            {scanningWorkspaces[menu.path] ? t('ws.scanningStatuses') : t('ws.checkAllStatus')}
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
          ideAsSubmenu
        >
          <SubMenuItem
            id="checkout"
            icon={<BranchUp className="ui-icon" size={14} color="currentColor" aria-hidden />}
            label={t('git.ctx.checkoutBranch')}
          >
            {projGitInfo?.info && projGitInfo.path === menu.path ? (
              <>
                {projCheckoutLocals.map((b) => (
                  <button
                    key={b.name}
                    type="button"
                    role="menuitem"
                    className="btn-with-icon"
                    onClick={() => void handleProjBranchSwitch(menu.path, b.name)}
                  >
                    <BranchDown className="ui-icon" size={14} color="currentColor" aria-hidden />
                    {t('git.ctx.checkout')} {b.name}
                  </button>
                ))}
                {projCheckoutRemotes.length > 0 && (
                  <>
                    <div className="branch-menu-sep" />
                    <span className="muted" style={{ fontSize: 10, padding: '2px 8px' }}>
                      {t('git.remoteBranches')}
                    </span>
                    {projCheckoutRemotes.map((b) => (
                      <button
                        key={b.name}
                        type="button"
                        role="menuitem"
                        className="btn-with-icon"
                        onClick={() => void handleProjBranchSwitch(menu.path, b.name)}
                      >
                        <ArrowRight className="ui-icon" size={14} color="currentColor" aria-hidden />
                        {t('git.ctx.checkout')} {projLocalName(b.name)}
                      </button>
                    ))}
                  </>
                )}
                {projCheckoutLocals.length === 0 && projCheckoutRemotes.length === 0 && (
                  <div className="branch-menu-hint muted">{t('git.ctx.noOtherBranches')}</div>
                )}
              </>
            ) : gitLoading ? (
              <span className="muted" style={{ fontSize: 10, padding: '2px 8px' }}>
                <Loader className="ui-icon is-spinning" size={10} color="currentColor" aria-hidden />
                {t('ws.scanningStatuses')}
              </span>
            ) : (
              <div className="branch-menu-hint muted">{t('git.ctx.noOtherBranches')}</div>
            )}
          </SubMenuItem>
          <SubMenuItem
            id="git-ops"
            icon={<Command className="ui-icon" size={14} color="currentColor" aria-hidden />}
            label={t('git.ctx.operations')}
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
            <div className="branch-menu-sep" />
            <button
              type="button"
              role="menuitem"
              className="btn-with-icon"
              onClick={() => {
                const path = menu.path
                setMenu(null)
                void (async () => {
                  setStatusChecking((prev) => new Set(prev).add(path))
                  try {
                    // Same behavior as before: run `git status` in the terminal;
                    // additionally wait for the shell prompt so the row spinner
                    // clears once the command finishes (capped at 10s).
                    const id = await projRunGit(path, 'git status')
                    await useTerminalStore.getState().waitUntilIdle(id, 10_000)
                  } finally {
                    setStatusChecking((prev) => {
                      const next = new Set(prev)
                      next.delete(path)
                      return next
                    })
                  }
                })()
              }}
            >
              <CheckCircle className="ui-icon" size={14} color="currentColor" aria-hidden />
              {t('git.ctx.status')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="btn-with-icon"
              onClick={() => {
                const path = menu.path
                const branch = projGitCurrent ?? 'HEAD'
                setMenu(null)
                void withGitOp(path, async () => {
                  // Run `git log` in the terminal; wait for the shell prompt
                  // so the row spinner clears once the command finishes.
                  const id = await projRunGit(path, `git log --format="%h %s (%ar)" -10 ${branch}`)
                  await useTerminalStore.getState().waitUntilIdle(id, 10_000)
                })
              }}
            >
              <Document className="ui-icon" size={14} color="currentColor" aria-hidden />
              {t('git.ctx.log')}
            </button>
            <div className="branch-menu-sep" />
            <button
              type="button"
              role="menuitem"
              className="btn-with-icon"
              onClick={() => {
                const path = menu.path
                setMenu(null)
                void withGitOp(path, async () => {
                  try {
                    // Backend-driven fetch — no terminal session needed.
                    await invoke<string>('git_fetch', { path })
                  } catch { /* ignore */ }
                  // Remote tips changed — refresh cached counts so the badge updates.
                  await refreshProjGitAfterSwitch(path)
                })
              }}
            >
              <Refresh className="ui-icon" size={14} color="currentColor" aria-hidden />
              {t('git.ctx.fetch')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="btn-with-icon"
              onClick={() => {
                const path = menu.path
                setMenu(null)
                void (async () => {
                  setPulling((prev) => new Set(prev).add(path))
                  try {
                    try {
                      // Backend-driven update-all: fast-forwards every pending
                      // branch (auto-stash for the current one) so the project
                      // badge actually clears; reports conflicts structurally.
                      const res = await invoke<PullBranchResult>('git_pull_all', {
                        path,
                      })
                      if (res.status === 'conflicts' && res.merge) {
                        setPullMerge({ projectPath: path, initial: res.merge })
                      }
                    } catch (e) {
                      showErrorLog(e, t('error.gitFailed'))
                    }
                    // Recompute behind counts and sync every cache.
                    await refreshProjGitAfterSwitch(path)
                    // Also surface conflicts detected outside our own pull.
                    try {
                      const status = await invoke<MergeStatus>('git_merge_status', { path }).catch(() => null)
                      if (status && (status.inProgress || status.conflictCount > 0)) {
                        setPullMerge((prev) => prev ?? { projectPath: path, initial: status })
                      }
                    } catch { /* ignore */ }
                  } finally {
                    setPulling((prev) => {
                      const next = new Set(prev)
                      next.delete(path)
                      return next
                    })
                  }
                })()
              }}
            >
              <ArrowDown className="ui-icon" size={14} color="currentColor" aria-hidden />
              {t('git.ctx.pull')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="btn-with-icon"
              onClick={() => {
                const path = menu.path
                setMenu(null)
                void withGitOp(path, async () => {
                  try {
                    // Backend-driven push (auto `-u` when no upstream yet).
                    await invoke<string>('git_push', { path, branch: null })
                  } catch (e) {
                    showErrorLog(e, t('error.gitFailed'))
                  }
                  await refreshProjGitAfterSwitch(path)
                })
              }}
            >
              <ArrowUp className="ui-icon" size={14} color="currentColor" aria-hidden />
              {t('git.ctx.push')}
            </button>
          </SubMenuItem>
          <div className="branch-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="btn-with-icon"
            onClick={() => {
              const name = findProject(menu.path)?.folderName
                ?? menu.path.split('/').pop()
                ?? menu.path
              setRenameTarget({ kind: 'project', path: menu.path, name })
              setMenu(null)
            }}
          >
            <Pen className="ui-icon" size={14} color="currentColor" aria-hidden />
            {t('fs.rename')}
          </button>
          {!isWorkspaceRoot(menu.path) && (
            <button
              type="button"
              role="menuitem"
              className="btn-with-icon danger"
              onClick={() => {
                const name = findProject(menu.path)?.folderName
                  ?? menu.path.split('/').pop()
                  ?? menu.path
                setPendingDelete({ kind: 'project', path: menu.path, name })
                setMenu(null)
              }}
            >
              <Trash className="ui-icon" size={14} color="currentColor" aria-hidden />
              {t('fs.delete')}
            </button>
          )}
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
          <div className="branch-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="btn-with-icon"
            onClick={() => {
              setRenameTarget({
                kind: 'entry',
                path: menu.path,
                projectPath: menu.projectPath,
                isDir: menu.isDir,
              })
              setMenu(null)
            }}
          >
            <Pen className="ui-icon" size={14} color="currentColor" aria-hidden />
            {t('fs.rename')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="btn-with-icon danger"
            onClick={() => {
              setPendingDelete({
                kind: 'entry',
                path: menu.path,
                isDir: menu.isDir,
                name: menu.path.split('/').pop() ?? menu.path,
              })
              setMenu(null)
            }}
          >
            <Trash className="ui-icon" size={14} color="currentColor" aria-hidden />
            {t('fs.delete')}
          </button>
        </ContextMenuPortal>
      )}

      {commitEntry && (
        <CommitModal
          projectPath={commitEntry.projectPath}
          projectName={findProjectName(commitEntry.projectPath)}
          branch={
            selectedProject?.path === commitEntry.projectPath
              ? (useProjectStore.getState().git?.current ?? 'HEAD')
              : (projGitInfo?.path === commitEntry.projectPath
                  ? (projGitInfo.info?.current ?? 'HEAD')
                  : 'HEAD')
          }
          paths={commitEntry.path.toLowerCase() === commitEntry.projectPath.toLowerCase() ? undefined : [commitEntry.path]}
          showPush={commitEntry.path.toLowerCase() === commitEntry.projectPath.toLowerCase()}
          onClose={() => setCommitEntry(null)}
          onDone={() => {
            setCommitEntry(null)
            if (selectedProject) void useProjectStore.getState().refreshGitStatus()
          }}
        />
      )}

      {pullMerge && (
        <MergeConflictModal
          projectPath={pullMerge.projectPath}
          initial={pullMerge.initial}
          onClose={() => setPullMerge(null)}
          onDone={() => {
            void refreshProjGitAfterSwitch(pullMerge.projectPath)
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
                  <span className="explorer-icon">
                    <FileIcon filename={f.relPath} size={14} />
                  </span>
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

      {renameTarget && (
        <RenameModal
          initial={
            renameTarget.kind === 'project'
              ? renameTarget.name
              : renameTarget.path.split('/').pop() ?? renameTarget.path
          }
          selectStem={renameTarget.kind === 'entry' && !renameTarget.isDir}
          onSubmit={(newName) =>
            renameTarget.kind === 'project'
              ? renameProject(renameTarget.path, newName)
              : renameEntry(renameTarget.path, renameTarget.isDir, newName)
          }
          onClose={() => setRenameTarget(null)}
        />
      )}

      {pendingDelete && (
        <ModalShell
          title={t('fs.deleteTitle')}
          onClose={() => setPendingDelete(null)}
          closeOnEsc={false}
          footer={
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setPendingDelete(null)}
              >
                {t('branch.cancel')}
              </button>
              <button
                type="button"
                className="btn danger btn-with-icon"
                onClick={() => {
                  const target = pendingDelete
                  setPendingDelete(null)
                  if (target.kind === 'project') void deleteProject(target.path)
                  else void deleteEntry(target.path, target.isDir)
                }}
              >
                <Trash className="ui-icon" size={14} color="currentColor" aria-hidden />
                {t('fs.delete')}
              </button>
            </div>
          }
        >
          <p className="muted">
            {pendingDelete.kind === 'project'
              ? t('fs.deleteProjectConfirm', { name: pendingDelete.name })
              : t('fs.deleteEntryConfirm', { name: pendingDelete.name })}
          </p>
        </ModalShell>
      )}

      {branchSwitchTarget && (
        <ModalShell
          title={t('branch.confirmTitle')}
          onClose={() => setBranchSwitchTarget(null)}
          closeOnEsc={false}
          footer={
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setBranchSwitchTarget(null)}
              >
                {t('branch.cancel')}
              </button>
              <button
                type="button"
                className="btn primary btn-with-icon"
                onClick={() => {
                  if (!branchSwitchTarget) return
                  const { projectPath, branch } = branchSwitchTarget
                  setBranchSwitchTarget(null)
                  void withGitOp(projectPath, async () => {
                    try {
                      await invoke<string>('git_checkout', { path: projectPath, branch })
                      await useSettingsStore.getState().touchBranchHistory(projectPath, branch)
                      await refreshProjGitAfterSwitch(projectPath)
                    } catch (e) {
                      showErrorLog(e, t('error.gitFailed'))
                    }
                  })
                }}
              >
                <ArrowRight className="ui-icon" size={14} color="currentColor" aria-hidden />
                {t('branch.confirm')}
              </button>
            </div>
          }
        >
          <p className="muted">
            {t('branch.dirtyDesc', { count: '…' })}
          </p>
        </ModalShell>
      )}
    </div>
  )
}
