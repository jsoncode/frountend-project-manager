import { invoke } from '@tauri-apps/api/core'
import { create } from '../lib/createStore'
import type { GitInfo, GitStatus, ProjectSummary } from '../lib/types'
import { useSettingsStore } from './settingsStore'

/** Per-project quick status summary (changed files + behind count). */
export type ProjectStatusSummary = {
  changedFiles: number
  behind: number
  currentBranch?: string
  /** Full git info (branches list) — cached from scan or selectProject. */
  gitInfo?: GitInfo | null
  /** Full git status (entries) — cached from scan or selectProject. */
  gitStatus?: GitStatus | null
}

type WorkspaceState = {
  activeWorkspace: string | null
  /** Projects for the active workspace (browse mode). */
  projects: ProjectSummary[]
  /** Cached scans keyed by workspace path (SQLite-backed). */
  projectCache: Record<string, ProjectSummary[]>
  /** Per-project status summaries keyed by project path. */
  projectStatuses: Record<string, ProjectStatusSummary>
  /** True while scanning all project statuses in a workspace. */
  scanningStatuses: boolean
  /** Scan progress: how many projects done vs total. */
  scanningProgress: { done: number; total: number }
  /** Set of project paths currently being scanned (loading). */
  scanningProjects: Set<string>
  loading: boolean
  /** True while filling missing workspace caches for cross-ws search. */
  searchScanning: boolean
  error: string | null
  search: string
  hydrated: boolean
  setSearch: (q: string) => void
  setActiveWorkspace: (path: string | null) => void
  /** Load project cache from SQLite (call once on boot). */
  hydrateCache: () => Promise<void>
  /** Rescan active workspace (and update cache). */
  refreshProjects: () => Promise<void>
  /** Rescan one workspace into the cache (and update active list if matches). */
  refreshWorkspace: (path: string) => Promise<void>
  /** Rescan every configured workspace into the cache. */
  refreshAllProjects: () => Promise<void>
  /** Ensure a single workspace is cached (tree expand). */
  ensureWorkspaceCached: (path: string) => Promise<void>
  /** Ensure every workspace is cached (used when searching). */
  ensureAllWorkspacesCached: () => Promise<void>
  /** Drop a workspace from cache (e.g. after remove). */
  dropWorkspaceCache: (path: string) => void
  /** Scan git status for all projects in a workspace. */
  scanAllProjectStatuses: (workspace: string) => Promise<void>
  /** Update a single project's cached status (for sync from projectStore). */
  updateProjectStatus: (projectPath: string, patch: Partial<ProjectStatusSummary>) => void
}

async function scanWorkspace(workspace: string): Promise<ProjectSummary[]> {
  return invoke<ProjectSummary[]>('list_projects', { workspace })
}

/**
 * Persist projectStatuses to the dedicated kv key.
 * Returns a promise so callers on the critical path (e.g. scanAllProjectStatuses)
 * can await the DB write before signalling completion — otherwise a user who
 * quits the app immediately after the scan UI shows "done" can lose the data.
 */
function persistStatuses(statuses: Record<string, ProjectStatusSummary>): Promise<void> {
  return invoke<void>('save_project_statuses', { data: statuses })
    .catch((e) => { console.warn('[persistStatuses] save failed:', e) })
}

/** Normalise a project path for tolerant lookups (separator + case). */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Re-key loaded statuses so their keys exactly match the project paths in the
 * loaded projectCache. Guards against separator/case drift between saves so
 * that `projectStatuses[p.path]` in the Explorer always hits cached data.
 * Purely additive — never drops entries.
 */
function alignStatusKeys(
  raw: Record<string, ProjectStatusSummary>,
  projectCache: Record<string, ProjectSummary[]>,
): Record<string, ProjectStatusSummary> {
  const out = { ...raw }
  const normIndex: Record<string, string> = {}
  for (const k of Object.keys(raw)) normIndex[normPath(k)] = k
  for (const ws of Object.keys(projectCache)) {
    for (const p of projectCache[ws]) {
      if (out[p.path]) continue
      const orig = normIndex[normPath(p.path)]
      if (orig) out[p.path] = raw[orig]
    }
  }
  return out
}

function persistCache(workspace: string, projects: ProjectSummary[]) {
  void invoke('save_project_cache', { workspace, projects }).catch(() => {})
}

/** Deduplicate concurrent cross-workspace cache fills. */
let ensureCacheInflight: Promise<void> | null = null

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeWorkspace: null,
  projects: [],
  projectCache: {},
  projectStatuses: {},
  scanningStatuses: false,
  scanningProgress: { done: 0, total: 0 },
  scanningProjects: new Set(),
  loading: false,
  searchScanning: false,
  error: null,
  search: '',
  hydrated: false,
  setSearch: (q) => {
    set({ search: q })
    if (q.trim()) {
      void get().ensureAllWorkspacesCached()
    }
  },
  setActiveWorkspace: (path) => {
    if (!path) {
      set({ activeWorkspace: null, projects: [], error: null, loading: false })
      return
    }
    const cached = get().projectCache[path]
    set({
      activeWorkspace: path,
      projects: cached ?? [],
      error: null,
      loading: cached === undefined,
    })
    void get().refreshProjects()
  },
  hydrateCache: async () => {
    try {
      const [remote, cachedStatuses] = await Promise.all([
        invoke<Record<string, ProjectSummary[]>>('load_project_cache'),
        invoke<Record<string, ProjectStatusSummary>>('load_project_statuses'),
      ])
      console.log('[hydrateCache] loaded statuses keys:', cachedStatuses ? Object.keys(cachedStatuses).length : 'null')
      set((s) => {
        const projectCache = { ...remote }
        const active = s.activeWorkspace
        const hasStatuses = cachedStatuses && Object.keys(cachedStatuses).length > 0
        // Re-key to match the freshly loaded projectCache paths so Explorer's
        // `projectStatuses[p.path]` lookup always hits cached data.
        const projectStatuses = hasStatuses ? alignStatusKeys(cachedStatuses, projectCache) : s.projectStatuses
        return {
          projectCache,
          projects:
            active && projectCache[active] ? projectCache[active]! : s.projects,
          hydrated: true,
          ...(hasStatuses ? { projectStatuses } : {}),
        }
      })
    } catch (e) {
      console.warn('[hydrateCache] failed:', e)
      set({ hydrated: true })
    }
  },
  refreshProjects: async () => {
    const ws = get().activeWorkspace
    if (!ws) return
    const hadCache = get().projectCache[ws] !== undefined
    if (!hadCache) set({ loading: true, error: null })
    try {
      const projects = await scanWorkspace(ws)
      set((s) => ({
        projectCache: { ...s.projectCache, [ws]: projects },
        projects: s.activeWorkspace === ws ? projects : s.projects,
        loading: false,
        error: null,
      }))
      persistCache(ws, projects)
    } catch (e) {
      set({ loading: false, error: String(e), projects: [] })
    }
  },
  refreshWorkspace: async (path) => {
    if (!path) return
    try {
      const projects = await scanWorkspace(path)
      set((s) => ({
        projectCache: { ...s.projectCache, [path]: projects },
        projects: s.activeWorkspace === path ? projects : s.projects,
        error: null,
      }))
      persistCache(path, projects)
    } catch (e) {
      set((s) => ({
        projectCache: { ...s.projectCache, [path]: [] },
        error: s.activeWorkspace === path ? String(e) : s.error,
      }))
    }
  },
  refreshAllProjects: async () => {
    const workspaces = useSettingsStore.getState().config?.workspaces ?? []
    if (workspaces.length === 0) {
      set({ projectCache: {}, projects: [], loading: false })
      return
    }
    set({ loading: true, error: null })
    try {
      const entries = await Promise.all(
        workspaces.map(async (ws) => {
          const list = await scanWorkspace(ws)
          return [ws, list] as const
        }),
      )
      const projectCache = Object.fromEntries(entries)
      const active = get().activeWorkspace
      set({
        projectCache,
        projects: active && projectCache[active] ? projectCache[active] : [],
        loading: false,
        error: null,
      })
      for (const [ws, list] of entries) {
        persistCache(ws, list)
      }
    } catch (e) {
      set({ loading: false, error: String(e) })
    }
  },
  ensureWorkspaceCached: async (path) => {
    if (!path) return
    if (get().projectCache[path] !== undefined) return
    try {
      const list = await scanWorkspace(path)
      set((s) => ({
        projectCache: { ...s.projectCache, [path]: list },
        projects:
          s.activeWorkspace === path
            ? list
            : s.projects,
      }))
      persistCache(path, list)
    } catch {
      set((s) => ({
        projectCache: { ...s.projectCache, [path]: [] },
      }))
    }
  },
  ensureAllWorkspacesCached: async () => {
    if (!ensureCacheInflight) {
      ensureCacheInflight = (async () => {
        set({ searchScanning: true })
        try {
          for (;;) {
            const workspaces =
              useSettingsStore.getState().config?.workspaces ?? []
            const missing = workspaces.filter(
              (ws) => get().projectCache[ws] === undefined,
            )
            if (missing.length === 0) break

            const entries = await Promise.all(
              missing.map(async (ws) => {
                try {
                  const list = await scanWorkspace(ws)
                  return [ws, list] as const
                } catch {
                  return [ws, [] as ProjectSummary[]] as const
                }
              }),
            )
            set((s) => {
              const projectCache = { ...s.projectCache }
              for (const [ws, list] of entries) {
                projectCache[ws] = list
              }
              const active = s.activeWorkspace
              return {
                projectCache,
                projects:
                  active && projectCache[active]
                    ? projectCache[active]!
                    : s.projects,
              }
            })
            for (const [ws, list] of entries) {
              persistCache(ws, list)
            }
          }
        } finally {
          set({ searchScanning: false })
          ensureCacheInflight = null
        }
      })()
    }
    await ensureCacheInflight
  },
  dropWorkspaceCache: (path) => {
    set((s) => {
      const projectCache = { ...s.projectCache }
      delete projectCache[path]
      // Also clear statuses for projects in this workspace
      const projects = s.projectCache[path] ?? []
      const projectStatuses = { ...s.projectStatuses }
      for (const p of projects) {
        delete projectStatuses[p.path]
      }
      return { projectCache, projectStatuses }
    })
    persistStatuses(get().projectStatuses)
    void invoke('drop_project_cache', { workspace: path }).catch(() => {})
  },
  scanAllProjectStatuses: async (workspace) => {
    if (!workspace) return
    const projects = get().projectCache[workspace]
    if (!projects || projects.length === 0) return
    const total = projects.length
    const scanningProjects = new Set(projects.map((p) => p.path))
    set({ scanningStatuses: true, scanningProgress: { done: 0, total }, scanningProjects })
    try {
      const results = await Promise.all(
        projects.map(async (p) => {
          try {
            const [gitStatus, gitInfo] = await Promise.all([
              invoke<GitStatus>('git_status', { path: p.path }).catch(() => null),
              invoke<GitInfo | null>('git_branches', { path: p.path }).catch(() => null),
            ])
            const changedFiles = gitStatus ? gitStatus.entries.length : 0
            // Current branch name (prefer gitInfo, fallback to gitStatus)
            const rawBranch = gitInfo?.current ?? gitStatus?.current
            const currentBranch = (rawBranch && rawBranch !== 'HEAD') ? rawBranch : undefined
            // Find current branch behind count
            let behind = 0
            if (gitInfo?.current && gitInfo.branches) {
              const currentBranchItem = gitInfo.branches.find(
                (b) => b.name === gitInfo.current && !b.isRemote
              )
              behind = currentBranchItem?.behind ?? 0
            }
            return [p.path, { changedFiles, behind, currentBranch, gitInfo, gitStatus }] as const
          } catch {
            return [p.path, { changedFiles: 0, behind: 0 }] as const
          } finally {
            // Mark this project as done
            set((s) => {
              const next = new Set(s.scanningProjects)
              next.delete(p.path)
              const done = total - next.size
              return {
                scanningProjects: next,
                scanningProgress: { done, total },
                scanningStatuses: next.size > 0 ? s.scanningStatuses : false,
              }
            })
          }
        }),
      )
      const projectStatuses = { ...get().projectStatuses }
      for (const [path, summary] of results) {
        projectStatuses[path] = summary
      }
      console.log('[scanAllProjectStatuses] persisting', Object.keys(projectStatuses).length, 'entries')
      // Await so the DB write completes BEFORE we flip scanningStatuses to
      // false. Otherwise a user who quits the app the instant the scan UI
      // shows "done" can lose all cached git data (fire-and-forget invoke).
      await persistStatuses(projectStatuses)
      set({ projectStatuses, scanningStatuses: false, scanningProjects: new Set() })
    } catch {
      set({ scanningStatuses: false, scanningProjects: new Set() })
    }
  },
  updateProjectStatus: (projectPath, patch) => {
    set((s) => {
      const existing = s.projectStatuses[projectPath]
      if (!existing) {
        const next = { ...s.projectStatuses, [projectPath]: patch as ProjectStatusSummary }
        persistStatuses(next)
        return { projectStatuses: next }
      }
      const next = {
        ...s.projectStatuses,
        [projectPath]: { ...existing, ...patch },
      }
      persistStatuses(next)
      return { projectStatuses: next }
    })
  },
}))
