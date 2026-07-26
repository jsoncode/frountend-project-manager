import { useEffect } from 'react'
import { DetailPane } from './components/DetailPane'
import { ErrorLogModal } from './components/ErrorLogModal'
import { IdeSettingsModal } from './components/IdeSettingsModal'
import { ProjectList } from './components/ProjectList'
import { ResizeHandle } from './components/ResizeHandle'
import { SettingsModal } from './components/SettingsModal'
import { TopBar } from './components/TopBar'
import { WorkspaceRail } from './components/WorkspaceRail'
import { AiSettingsModal } from './components/AiSettingsModal'
import { useLayoutStore } from './stores/layoutStore'
import { useSettingsStore } from './stores/settingsStore'
import { useTerminalStore } from './stores/terminalStore'
import { useWorkspaceStore } from './stores/workspaceStore'
import './styles/tokens.css'
import './styles/app.css'
import './styles/ai.css'

export default function App() {
  const load = useSettingsStore((s) => s.load)
  const config = useSettingsStore((s) => s.config)
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace)
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace)
  const startListening = useTerminalStore((s) => s.startListening)
  const railWidth = useLayoutStore((s) => s.railWidth)
  const listWidth = useLayoutStore((s) => s.listWidth)
  const persist = useLayoutStore((s) => s.persist)

  useEffect(() => {
    void (async () => {
      await useLayoutStore.getState().hydrate()
      await useWorkspaceStore.getState().hydrateCache()
      await load()
    })()
  }, [load])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    void startListening().then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [startListening])

  useEffect(() => {
    if (!config) return
    if (!activeWorkspace && config.workspaces[0]) {
      setActiveWorkspace(config.workspaces[0])
    }
  }, [config, activeWorkspace, setActiveWorkspace])

  return (
    <div className="app-shell">
      <TopBar />
      <div
        className="main"
        style={{
          gridTemplateColumns: `${railWidth}px 5px ${listWidth}px 5px minmax(0, 1fr)`,
        }}
      >
        <WorkspaceRail />
        <ResizeHandle
          orientation="vertical"
          onDrag={(d) => {
            const { railWidth, setRailWidth } = useLayoutStore.getState()
            setRailWidth(railWidth + d)
          }}
          onDragEnd={persist}
        />
        <ProjectList />
        <ResizeHandle
          orientation="vertical"
          onDrag={(d) => {
            const { listWidth, setListWidth } = useLayoutStore.getState()
            setListWidth(listWidth + d)
          }}
          onDragEnd={persist}
        />
        <DetailPane />
      </div>
      <SettingsModal />
      <IdeSettingsModal />
      <AiSettingsModal />
      <ErrorLogModal />
    </div>
  )
}
