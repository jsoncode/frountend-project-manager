import { invoke } from '@tauri-apps/api/core'
import {
  buildGitDecorationIndex,
  EMPTY_GIT_DECORATIONS,
  type GitDecorationIndex,
} from '../lib/gitDecorations'
import { create } from '../lib/createStore'
import type {
  EnvEntry,
  EnvFileInfo,
  GitInfo,
  GitStatus,
  ProjectDetails,
  ProjectSummary,
} from '../lib/types'
import { useSettingsStore } from './settingsStore'

type ProjectState = {
  selected: ProjectSummary | null
  details: ProjectDetails | null
  git: GitInfo | null
  gitStatus: GitStatus | null
  gitDecorations: GitDecorationIndex
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
  refreshGitStatus: () => Promise<void>
}

/** Ignore stale async results when the user switches projects quickly. */
let selectSeq = 0
let statusSeq = 0

function applyGitStatus(
  projectPath: string | undefined,
  status: GitStatus | null,
): Pick<ProjectState, 'gitStatus' | 'gitDecorations'> {
  if (!projectPath || !status) {
    return { gitStatus: status, gitDecorations: EMPTY_GIT_DECORATIONS }
  }
  return {
    gitStatus: status,
    gitDecorations: buildGitDecorationIndex(projectPath, status.entries),
  }
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  selected: null,
  details: null,
  git: null,
  gitStatus: null,
  gitDecorations: EMPTY_GIT_DECORATIONS,
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
        gitStatus: null,
        gitDecorations: EMPTY_GIT_DECORATIONS,
        envFiles: [],
        envEntries: [],
        selectedEnvPath: null,
        loading: false,
        error: null,
      })
      return
    }

    set({
      selected: project,
      details: {
        summary: project,
        packageManager: 'npm',
      },
      git: null,
      gitStatus: null,
      gitDecorations: EMPTY_GIT_DECORATIONS,
      envFiles: [],
      envEntries: [],
      selectedEnvPath: null,
      loading: true,
      error: null,
    })

    void useSettingsStore.getState().touchProjectAccess(project.path)

    try {
      const [details, git, envFiles, gitStatus] = await Promise.all([
        invoke<ProjectDetails>('scan_project', { path: project.path }),
        invoke<GitInfo | null>('git_branches', { path: project.path }),
        invoke<EnvFileInfo[]>('list_env_files', { path: project.path }),
        invoke<GitStatus>('git_status', { path: project.path }).catch(
          () => null,
        ),
      ])
      if (seq !== selectSeq) return
      set({
        details,
        git,
        envFiles,
        loading: false,
        ...applyGitStatus(project.path, gitStatus),
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
      const git = await invoke<GitInfo | null>('git_branches', {
        path: selected.path,
      })
      set({ git })
      await get().refreshGitStatus()
    } catch (e) {
      set({ error: String(e) })
    }
  },
  refreshGitStatus: async () => {
    const selected = get().selected
    if (!selected) {
      set({
        gitStatus: null,
        gitDecorations: EMPTY_GIT_DECORATIONS,
      })
      return
    }
    const seq = ++statusSeq
    try {
      const gitStatus = await invoke<GitStatus>('git_status', {
        path: selected.path,
      })
      if (seq !== statusSeq) return
      if (get().selected?.path !== selected.path) return
      set(applyGitStatus(selected.path, gitStatus))
    } catch {
      if (seq !== statusSeq) return
      set({
        gitStatus: null,
        gitDecorations: EMPTY_GIT_DECORATIONS,
      })
    }
  },
}))
