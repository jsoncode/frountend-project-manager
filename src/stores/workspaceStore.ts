import { invoke } from '@tauri-apps/api/core'
import { create } from '../lib/createStore'
import type { ProjectSummary } from '../lib/types'
import { useSettingsStore } from './settingsStore'

type WorkspaceState = {
  activeWorkspace: string | null
  /** Projects for the active workspace (browse mode). */
  projects: ProjectSummary[]
  /** Cached scans keyed by workspace path (SQLite-backed). */
  projectCache: Record<string, ProjectSummary[]>
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
}

async function scanWorkspace(workspace: string): Promise<ProjectSummary[]> {
  return invoke<ProjectSummary[]>('list_projects', { workspace })
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
      const remote = await invoke<Record<string, ProjectSummary[]>>(
        'load_project_cache',
      )
      set((s) => {
        const projectCache = { ...remote }
        const active = s.activeWorkspace
        return {
          projectCache,
          projects:
            active && projectCache[active] ? projectCache[active]! : s.projects,
          hydrated: true,
        }
      })
    } catch {
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
      return { projectCache }
    })
    void invoke('drop_project_cache', { workspace: path }).catch(() => {})
  },
}))
