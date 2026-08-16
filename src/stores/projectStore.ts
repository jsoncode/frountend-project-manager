import { invoke } from '@tauri-apps/api/core'
import {
  buildGitDecorationIndex,
  EMPTY_GIT_DECORATIONS,
  type GitDecorationIndex,
} from '../lib/gitDecorations'
import { create } from '../lib/createStore'
import { maxBranchBehind } from '../lib/gitInfo'
import type {
  GitInfo,
  GitStatus,
  MergeStatus,
  ProjectDetails,
  ProjectSummary,
} from '../lib/types'
import { useSettingsStore } from './settingsStore'
import { useWorkspaceStore } from './workspaceStore'

type ProjectState = {
  selected: ProjectSummary | null
  details: ProjectDetails | null
  git: GitInfo | null
  gitStatus: GitStatus | null
  mergeStatus: MergeStatus | null
  gitDecorations: GitDecorationIndex
  loading: boolean
  error: string | null
  selectProject: (project: ProjectSummary | null) => Promise<void>
  refresh: () => Promise<void>
  refreshGit: (opts?: { fetch?: boolean }) => Promise<void>
  refreshGitStatus: () => Promise<void>
  /** Full git re-check for one project (used on project expand). */
  refreshProjectGitStatus: (
    projectPath: string,
    opts?: { fetch?: boolean },
  ) => Promise<void>
  refreshMergeStatus: () => Promise<void>
}

/** Ignore stale async results when the user switches projects quickly. */
let selectSeq = 0
let statusSeq = 0
let mergeSeq = 0
let gitSeq = 0

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
  mergeStatus: null,
  gitDecorations: EMPTY_GIT_DECORATIONS,
  loading: false,
  error: null,
  selectProject: async (project) => {
    const seq = ++selectSeq

    if (!project) {
      set({
        selected: null,
        details: null,
        git: null,
        gitStatus: null,
        mergeStatus: null,
        gitDecorations: EMPTY_GIT_DECORATIONS,
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
      mergeStatus: null,
      gitDecorations: EMPTY_GIT_DECORATIONS,
      loading: true,
      error: null,
    })

    void useSettingsStore.getState().touchProjectAccess(project.path)

    // Check if workspaceStore has cached git data from a recent scan
    const cachedStatus = useWorkspaceStore.getState().projectStatuses[project.path]
    const hasCachedGitInfo = !!cachedStatus?.gitInfo

    // Seed state immediately from cache if available (shows stale data instantly)
    if (cachedStatus?.gitInfo || cachedStatus?.gitStatus) {
      const cachedGitInfo = cachedStatus?.gitInfo ?? null
      const cachedGitStatus = cachedStatus?.gitStatus ?? null
      set({
        selected: project,
        details: { summary: project, packageManager: 'npm' },
        git: cachedGitInfo,
        mergeStatus: null,
        loading: true,
        error: null,
        ...applyGitStatus(project.path, cachedGitStatus),
      })
    }

    try {
      // Always fetch fresh gitStatus (changes frequently).
      // Only skip git_branches fetch if we have cached gitInfo.
      const gitFetch = hasCachedGitInfo
        ? Promise.resolve(cachedStatus?.gitInfo ?? null)
        : invoke<GitInfo | null>('git_branches', { path: project.path })
      const gitStatusFetch = invoke<GitStatus>('git_status', { path: project.path }).catch(() => null)

      const [details, git, gitStatus, mergeStatus] = await Promise.all([
        invoke<ProjectDetails>('scan_project', { path: project.path }),
        gitFetch,
        gitStatusFetch,
        invoke<MergeStatus>('git_merge_status', { path: project.path }).catch(
          () => null,
        ),
      ])
      if (seq !== selectSeq) return
      set({
        details,
        git,
        mergeStatus,
        loading: false,
        ...applyGitStatus(project.path, gitStatus),
      })
      // Sync back to workspaceStore cache
      useWorkspaceStore.getState().updateProjectStatus(project.path, {
        gitInfo: git,
        gitStatus,
        changedFiles: gitStatus ? gitStatus.entries.length : (cachedStatus?.changedFiles ?? 0),
        behind: maxBranchBehind(git),
        currentBranch: ((git?.current && git.current !== 'HEAD') ? git.current : gitStatus?.current) ?? cachedStatus?.currentBranch,
      })
    } catch (e) {
      if (seq !== selectSeq) return
      set({ loading: false, error: String(e) })
    }
  },
  refresh: async () => {
    const selected = get().selected
    if (selected) await get().selectProject(selected)
  },
  refreshGit: async (opts) => {
    const selected = get().selected
    if (!selected) return
    // Stale-response guard: git_fetch can be slow; if the user switches
    // projects while it runs, the late response must not render project A's
    // branches into project B's panel (audit P1-4).
    const seq = ++gitSeq
    const stillCurrent = () => seq === gitSeq && get().selected?.path === selected.path
    try {
      if (opts?.fetch) {
        await invoke('git_fetch', { path: selected.path })
        if (!stillCurrent()) return
      }
      const git = await invoke<GitInfo | null>('git_branches', {
        path: selected.path,
      })
      if (!stillCurrent()) return
      set({ git })
      // Sync git info to workspaceStore (behind included so the Explorer
      // project badge stays in sync with the branch panel after fetch).
      useWorkspaceStore.getState().updateProjectStatus(selected.path, {
        gitInfo: git,
        behind: maxBranchBehind(git),
        currentBranch: (git?.current && git.current !== 'HEAD') ? git.current : undefined,
      })
      await Promise.all([get().refreshGitStatus(), get().refreshMergeStatus()])
    } catch (e) {
      if (seq !== gitSeq) return
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
      // Sync git status to workspaceStore
      useWorkspaceStore.getState().updateProjectStatus(selected.path, {
        gitStatus,
        changedFiles: gitStatus.entries.length,
      })
    } catch {
      if (seq !== statusSeq) return
      set({
        gitStatus: null,
        gitDecorations: EMPTY_GIT_DECORATIONS,
      })
    }
  },
  /**
   * Full git re-check for one project — used when a project is expanded so
   * the 待提交/待拉取 badges stay as real-time as possible. Best-effort
   * `git fetch` runs first so "behind" counts reflect the latest remote tips
   * (offline repos simply keep their last refs), then branches + status +
   * merge are fetched. Always syncs the workspaceStore summary (explorer
   * badges); when the project is the selected one, projectStore state is
   * synced too (branch panel, file decorations, merge modal).
   * Pass `opts.fetch === false` when refs are already fresh (pull / checkout
   * / explicit fetch) to skip the network round-trip.
   */
  refreshProjectGitStatus: async (projectPath, opts) => {
    if (opts?.fetch !== false) {
      await invoke('git_fetch', { path: projectPath }).catch(() => {})
    }
    const [git, gitStatus, mergeStatus] = await Promise.all([
      invoke<GitInfo | null>('git_branches', { path: projectPath }).catch(() => null),
      invoke<GitStatus>('git_status', { path: projectPath }).catch(() => null),
      invoke<MergeStatus>('git_merge_status', { path: projectPath }).catch(() => null),
    ])
    const rawBranch = git?.current ?? gitStatus?.current
    const currentBranch =
      rawBranch && rawBranch !== 'HEAD' ? rawBranch : undefined
    const behind = maxBranchBehind(git)
    useWorkspaceStore.getState().updateProjectStatus(projectPath, {
      gitInfo: git,
      gitStatus,
      currentBranch,
      changedFiles: gitStatus ? gitStatus.entries.length : undefined,
      behind,
    })
    const ps = get()
    if (ps.selected?.path === projectPath) {
      set({
        git,
        gitStatus,
        mergeStatus,
        gitDecorations: gitStatus
          ? buildGitDecorationIndex(projectPath, gitStatus.entries)
          : ps.gitDecorations,
      })
    }
  },
  refreshMergeStatus: async () => {
    const selected = get().selected
    if (!selected) {
      set({ mergeStatus: null })
      return
    }
    const seq = ++mergeSeq
    try {
      const mergeStatus = await invoke<MergeStatus>('git_merge_status', {
        path: selected.path,
      })
      if (seq !== mergeSeq) return
      if (get().selected?.path !== selected.path) return
      set({ mergeStatus })
    } catch {
      if (seq !== mergeSeq) return
      set({ mergeStatus: null })
    }
  },
}))
