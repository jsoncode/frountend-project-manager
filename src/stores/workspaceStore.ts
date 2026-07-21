import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import type { ProjectSummary } from '../lib/types'

type WorkspaceState = {
  activeWorkspace: string | null
  projects: ProjectSummary[]
  loading: boolean
  error: string | null
  search: string
  activeTagFilters: string[]
  setSearch: (q: string) => void
  toggleTagFilter: (tag: string) => void
  clearTagFilters: () => void
  setActiveWorkspace: (path: string | null) => void
  refreshProjects: () => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeWorkspace: null,
  projects: [],
  loading: false,
  error: null,
  search: '',
  activeTagFilters: [],
  setSearch: (q) => set({ search: q }),
  toggleTagFilter: (tag) => {
    const cur = get().activeTagFilters
    set({
      activeTagFilters: cur.includes(tag)
        ? cur.filter((t) => t !== tag)
        : [...cur, tag],
    })
  },
  clearTagFilters: () => set({ activeTagFilters: [] }),
  setActiveWorkspace: (path) => {
    set({ activeWorkspace: path, projects: [], error: null })
    if (path) void get().refreshProjects()
  },
  refreshProjects: async () => {
    const ws = get().activeWorkspace
    if (!ws) return
    set({ loading: true, error: null })
    try {
      const projects = await invoke<ProjectSummary[]>('list_projects', {
        workspace: ws,
      })
      set({ projects, loading: false })
    } catch (e) {
      set({ loading: false, error: String(e), projects: [] })
    }
  },
}))
