import { useEffect } from 'react'
import { AiSettingsModal } from './components/AiSettingsModal'
import { DetailPane } from './components/DetailPane'
import { ErrorLogModal } from './components/ErrorLogModal'
import { NewWorkspaceModal } from './components/NewWorkspaceModal'
import { Sidebar } from './components/Sidebar'
import { IdeSettingsModal } from './components/IdeSettingsModal'
import { ResizeHandle } from './components/ResizeHandle'
import { SettingsModal } from './components/SettingsModal'
import { TopBar } from './components/TopBar'
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
  const explorerWidth = useLayoutStore((s) => s.explorerWidth)
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
          gridTemplateColumns: `${explorerWidth}px 4px minmax(0, 1fr)`,
        }}
      >
        <Sidebar />
        <ResizeHandle
          orientation="vertical"
          onDrag={(d) => {
            const { explorerWidth, setExplorerWidth } = useLayoutStore.getState()
            setExplorerWidth(explorerWidth + d)
          }}
          onDragEnd={persist}
        />
        <DetailPane />
      </div>
      <SettingsModal />
      <IdeSettingsModal />
      <AiSettingsModal />
      <ErrorLogModal />
      <NewWorkspaceModal />
    </div>
  )
}
