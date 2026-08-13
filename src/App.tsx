import { useEffect } from 'react'
import { AiSettingsModal } from './components/AiSettingsModal'
import { ActionBar } from './components/ActionBar'
import { DetailPane } from './components/DetailPane'
import { ErrorLogModal } from './components/ErrorLogModal'
import { NewWorkspaceModal } from './components/NewWorkspaceModal'
import { Sidebar } from './components/Sidebar'
import { IdeSettingsModal } from './components/IdeSettingsModal'
import { JenCliSettingsModal } from './components/JenCliSettingsModal'
import { ResizeHandle } from './components/ResizeHandle'
import { SettingsModal } from './components/SettingsModal'
import { TopBar } from './components/TopBar'
import { useLayoutStore } from './stores/layoutStore'
import { useSessionStore, initSessionAutoSave } from './stores/sessionStore'
import { useSettingsStore } from './stores/settingsStore'
import { useTerminalStore } from './stores/terminalStore'
import { useWorkspaceStore } from './stores/workspaceStore'
import './styles/tokens.css'
import './styles/app.css'
import './styles/antd-overrides.css'
import './styles/ai.css'

export default function App() {
  const load = useSettingsStore((s) => s.load)
  const config = useSettingsStore((s) => s.config)
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace)
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace)
  const startListening = useTerminalStore((s) => s.startListening)
  const explorerWidth = useLayoutStore((s) => s.explorerWidth)
  const toolPanelWidth = useLayoutStore((s) => s.toolPanelWidth)
  const persist = useLayoutStore((s) => s.persist)

  useEffect(() => {
    void (async () => {
      await useLayoutStore.getState().hydrate()
      await useWorkspaceStore.getState().hydrateCache()
      await useSessionStore.getState().hydrate()
      await load()
      initSessionAutoSave()
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

  // Force workspaceStore subscribers (Explorer) to re-render with the cached
  // projectStatuses once workspace rows are actually visible. hydrateCache
  // loads these statuses early, but at that moment config (workspaces list)
  // isn't ready yet so no project rows render — the cached git badges would
  // only appear after the user manually expands a project. Re-applying here
  // (after config is loaded) guarantees all projects echo their cached git
  // status immediately on restart, without requiring an expand.
  const wsHydrated = useWorkspaceStore((s) => s.hydrated)
  useEffect(() => {
    if (!config || !wsHydrated) return
    const ws = useWorkspaceStore.getState()
    if (Object.keys(ws.projectStatuses).length > 0) {
      useWorkspaceStore.setState({ projectStatuses: { ...ws.projectStatuses } })
    }
  }, [config, wsHydrated])

  // Convert vertical wheel to horizontal scroll for horizontal-only
  // containers (tab bars, quick lists) so devices without a trackpad
  // can still scroll sideways.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      // Only intercept pure vertical wheel (no horizontal delta from trackpad)
      if (e.deltaY === 0 || e.deltaX !== 0) return
      const target = e.target
      if (!(target instanceof Element)) return
      let el: Element | null = target
      while (el && el !== document.body) {
        const style = getComputedStyle(el)
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
          const hasHOverflow = el.scrollWidth > el.clientWidth + 1
          const noVOverflow = el.scrollHeight <= el.clientHeight + 1
          if (hasHOverflow && noVOverflow) {
            e.preventDefault()
            el.scrollLeft += e.deltaY
            return
          }
        }
        el = el.parentElement
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div className="app-shell">
      <TopBar />
      <div
        className="main"
        style={{
          gridTemplateColumns: `${explorerWidth}px 4px ${toolPanelWidth}px 4px minmax(0, 1fr)`,
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
        <ActionBar />
        <ResizeHandle
          orientation="vertical"
          onDrag={(d) => {
            const { toolPanelWidth, setToolPanelWidth } =
              useLayoutStore.getState()
            setToolPanelWidth(toolPanelWidth + d)
          }}
          onDragEnd={persist}
        />
        <DetailPane />
      </div>
      <SettingsModal />
      <IdeSettingsModal />
      <JenCliSettingsModal />
      <AiSettingsModal />
      <ErrorLogModal />
      <NewWorkspaceModal />
    </div>
  )
}
