import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import type {
  EnvEntry,
  EnvFileInfo,
  GitInfo,
  ProjectDetails,
  ProjectSummary,
} from '../lib/types'
import { useSettingsStore } from './settingsStore'

type ProjectState = {
  selected: ProjectSummary | null
  details: ProjectDetails | null
  git: GitInfo | null
  envFiles: EnvFileInfo[]
  envEntries: EnvEntry[]
  selectedEnvPath: string | null
  revealEnv: boolean
  loading: boolean
  error: string | null
  selectProject: (project: ProjectSummary | null) => Promise<void>
  loadEnvEntries: (path: string) => Promise<void>
  setRevealEnv: (v: boolean) => void
  refresh: () => Promise<void>
  refreshGit: (opts?: { fetch?: boolean }) => Promise<void>
}

/** Ignore stale async results when the user switches projects quickly. */
let selectSeq = 0

export const useProjectStore = create<ProjectState>((set, get) => ({
  selected: null,
  details: null,
  git: null,
  envFiles: [],
  envEntries: [],
  selectedEnvPath: null,
  revealEnv: false,
  loading: false,
  error: null,
  setRevealEnv: (v) => set({ revealEnv: v }),
  selectProject: async (project) => {
    const seq = ++selectSeq

    if (!project) {
      set({
        selected: null,
        details: null,
        git: null,
        envFiles: [],
        envEntries: [],
        selectedEnvPath: null,
        loading: false,
        error: null,
      })
      return
    }

    // Optimistic UI: scripts/frameworks already on the list summary — don't wait.
    set({
      selected: project,
      details: {
        summary: project,
        languages: [],
        packageManager: 'npm',
      },
      git: null,
      envFiles: [],
      envEntries: [],
      selectedEnvPath: null,
      loading: true,
      error: null,
    })

    void useSettingsStore.getState().touchProjectAccess(project.path)

    try {
      const [details, git, envFiles] = await Promise.all([
        invoke<ProjectDetails>('scan_project', { path: project.path }),
        invoke<GitInfo | null>('git_branches', { path: project.path }),
        invoke<EnvFileInfo[]>('list_env_files', { path: project.path }),
      ])
      if (seq !== selectSeq) return
      set({
        details,
        git,
        envFiles,
        loading: false,
      })
    } catch (e) {
      if (seq !== selectSeq) return
      set({ loading: false, error: String(e) })
    }
  },
  loadEnvEntries: async (path) => {
    set({ selectedEnvPath: path })
    try {
      const envEntries = await invoke<EnvEntry[]>('read_env_file', { path })
      set({ envEntries })
    } catch (e) {
      set({ error: String(e), envEntries: [] })
    }
  },
  refresh: async () => {
    const selected = get().selected
    if (selected) await get().selectProject(selected)
  },
  refreshGit: async (opts) => {
    const selected = get().selected
    if (!selected) return
    try {
      if (opts?.fetch) {
        await invoke('git_fetch', { path: selected.path })
      }
      const git = await invoke<GitInfo | null>('git_branches', { path: selected.path })
      set({ git })
    } catch (e) {
      set({ error: String(e) })
    }
  },
}))
