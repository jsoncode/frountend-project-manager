import { invoke } from '@tauri-apps/api/core'
import { create } from '../lib/createStore'
import { useEditorStore } from './editorStore'
import { useExplorerStore } from './explorerStore'
import { useLayoutStore } from './layoutStore'
import { useProjectStore } from './projectStore'
import { useTerminalStore } from './terminalStore'
import { useWorkspaceStore } from './workspaceStore'

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
        useWorkspaceStore.setState({ activeWorkspace: session.activeWorkspace })
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
        const found = projects.find((p) => p.path === session.selectedProjectPath)
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
      // Delay enabling auto-save slightly to avoid saving during initial render
      setTimeout(() => {
        isHydrating = false
      }, 1000)
    }
  },
}))

/**
 * Subscribe to all relevant stores and auto-save session on changes.
 * Call once at app startup.
 */
export function initSessionAutoSave() {
  useLayoutStore.subscribe(() => scheduleSave())
  useWorkspaceStore.subscribe(() => scheduleSave())
  useExplorerStore.subscribe(() => scheduleSave())
  useEditorStore.subscribe(() => scheduleSave())
  useTerminalStore.subscribe(() => scheduleSave())
}
