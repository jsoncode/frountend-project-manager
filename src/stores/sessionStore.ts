import { invoke } from '@tauri-apps/api/core'
import { create } from '../lib/createStore'
import { useEditorStore } from './editorStore'
import { useExplorerStore } from './explorerStore'
import { useLayoutStore } from './layoutStore'
import { useProjectStore } from './projectStore'
import { useTerminalStore } from './terminalStore'
import { normPath, useWorkspaceStore } from './workspaceStore'

type SessionSnapshot = {
  activeWorkspace?: string | null
  expanded?: string[]
  selectedProjectPath?: string | null
  editorTabs?: { path: string; projectPath: string }[]
  editorActivePath?: string | null
  terminalSessions?: { projectPath: string; projectName: string }[]
  terminalActiveProject?: string | null
}

type SessionState = {
  hydrated: boolean
  hydrate: () => Promise<void>
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let isHydrating = false

function scheduleSave() {
  if (isHydrating) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveSession()
  }, 500)
}

async function saveSession() {
  if (isHydrating) return

  const editor = useEditorStore.getState()
  const terminal = useTerminalStore.getState()
  const workspace = useWorkspaceStore.getState()
  const explorer = useExplorerStore.getState()
  const project = useProjectStore.getState()

  const snapshot: SessionSnapshot = {
    activeWorkspace: workspace.activeWorkspace,
    expanded: explorer.expanded,
    selectedProjectPath: project.selected?.path ?? null,
    editorTabs: editor.tabs.map((t) => ({
      path: t.path,
      projectPath: t.projectPath,
    })),
    editorActivePath: editor.activePath,
    terminalSessions: terminal.sessions.map((s) => ({
      projectPath: s.projectPath,
      projectName: s.projectName,
    })),
    terminalActiveProject: terminal.activeId
      ? terminal.sessions.find((s) => s.id === terminal.activeId)?.projectPath ?? null
      : null,
  }

  try {
    await invoke('save_session', { session: snapshot })
  } catch {
    /* ignore */
  }
}

export const useSessionStore = create<SessionState>((_set, _get) => ({
  hydrated: false,
  hydrate: async () => {
    isHydrating = true
    try {
      let session: SessionSnapshot | null = null
      try {
        session = await invoke<SessionSnapshot | null>('load_session')
      } catch {
        /* ignore — first launch or no saved session */
      }

      if (!session) {
        isHydrating = false
        _set({ hydrated: true })
        return
      }

      // 1. Restore active workspace
      if (session.activeWorkspace) {
        const cachedProjects = useWorkspaceStore.getState().projectCache[session.activeWorkspace]
        useWorkspaceStore.setState({
          activeWorkspace: session.activeWorkspace,
          // Populate projects from cache so the Explorer renders project rows
          // (and their git status badges) immediately after hydration.
          ...(cachedProjects ? { projects: cachedProjects } : {}),
        })
        // Ensure the workspace projects are cached
        await useWorkspaceStore.getState().ensureWorkspaceCached(session.activeWorkspace)
      }

      // 2. Restore selected project
      if (session.selectedProjectPath) {
        const ws = useWorkspaceStore.getState()
        const activeWs = session.activeWorkspace ?? ws.activeWorkspace
        const projects = activeWs
          ? ws.projectCache[activeWs] ?? []
          : []
        const found = projects.find(
          (p) => normPath(p.path) === normPath(session.selectedProjectPath!),
        )
        if (found) {
          void useProjectStore.getState().selectProject(found)
        }
      }

      // 3. Restore explorer expanded
      if (session.expanded && session.expanded.length > 0) {
        useExplorerStore.setState({ expanded: session.expanded })
      }

      // 4. Restore editor tabs
      if (session.editorTabs && session.editorTabs.length > 0) {
        const tabs = session.editorTabs.map((t) => ({
          path: t.path,
          projectPath: t.projectPath,
        }))
        useEditorStore.setState({
          tabs,
          activePath: session.editorActivePath ?? tabs[0]?.path ?? null,
        })
      }

      // 5. Restore terminal sessions (create new PTYs)
      if (session.terminalSessions && session.terminalSessions.length > 0) {
        const terminalStore = useTerminalStore.getState()
        let restoredActiveId: string | null = null

        for (const ts of session.terminalSessions) {
          const id = terminalStore.createSession(ts.projectPath, ts.projectName)
          if (ts.projectPath === session.terminalActiveProject) {
            restoredActiveId = id
          }
        }

        if (restoredActiveId) {
          useTerminalStore.setState({ activeId: restoredActiveId })
        }
      }

      _set({ hydrated: true })
    } finally {
      isHydrating = false
      // Persist the hydrated state so it survives the next restart.
      // scheduleSave() already debounces internally (500ms).
      scheduleSave()

      // Force workspaceStore subscribers (Explorer) to re-render with the
      // cached projectStatuses that were loaded by hydrateCache().
      // Without this, the git-status badges may not appear on project rows
      // until the user manually expands a project.
      const ws = useWorkspaceStore.getState()
      if (Object.keys(ws.projectStatuses).length > 0) {
        useWorkspaceStore.setState({ projectStatuses: { ...ws.projectStatuses } })
      }
    }
  },
}))

/**
 * Subscribe to all relevant stores and auto-save session on changes.
 * Call once at app startup. Returns an unsubscribe that removes every
 * listener — previously the subscriptions were dropped, piling up under
 * HMR / repeated init (audit P2-14).
 */
export function initSessionAutoSave() {
  const unsubs = [
    useLayoutStore.subscribe(() => scheduleSave()),
    useWorkspaceStore.subscribe(() => scheduleSave()),
    useExplorerStore.subscribe(() => scheduleSave()),
    useEditorStore.subscribe(() => scheduleSave()),
    useTerminalStore.subscribe(() => scheduleSave()),
    // The snapshot records selectedProjectPath — subscribe so selection
    // changes reach disk even when the workspace scan path fails (audit P2-14).
    useProjectStore.subscribe(() => scheduleSave()),
  ]
  return () => {
    for (const unsub of unsubs) unsub()
  }
}
