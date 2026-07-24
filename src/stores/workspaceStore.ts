import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import type { ProjectSummary } from '../lib/types'
import { useSettingsStore } from './settingsStore'

type WorkspaceState = {
  activeWorkspace: string | null
  /** Projects for the active workspace (browse mode). */
  projects: ProjectSummary[]
  /** Cached scans keyed by workspace path. */
  projectCache: Record<string, ProjectSummary[]>
  loading: boolean
  /** True while filling missing workspace caches for cross-ws search. */
  searchScanning: boolean
  error: string | null
  search: string
  setSearch: (q: string) => void
  setActiveWorkspace: (path: string | null) => void
  /** Rescan active workspace (and update cache). */
  refreshProjects: () => Promise<void>
  /** Rescan every configured workspace into the cache. */
  refreshAllProjects: () => Promise<void>
  /** Ensure every workspace is cached (used when searching). */
  ensureAllWorkspacesCached: () => Promise<void>
  /** Drop a workspace from cache (e.g. after remove). */
  dropWorkspaceCache: (path: string) => void
}

async function scanWorkspace(workspace: string): Promise<ProjectSummary[]> {
  return invoke<ProjectSummary[]>('list_projects', { workspace })
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
    } catch (e) {
      set({ loading: false, error: String(e), projects: [] })
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
    } catch (e) {
      set({ loading: false, error: String(e) })
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
  },
}))
