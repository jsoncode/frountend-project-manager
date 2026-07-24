import { useEffect } from 'react'
import { useAiStore } from '../stores/aiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { AiComposer } from './AiComposer'
import { AiMessageList } from './AiMessageList'
import { AiSidebar } from './AiSidebar'
import { AiTopBar } from './AiTopBar'
import '../styles/tokens.css'
import '../styles/app.css'
import '../styles/ai.css'

export default function AiApp() {
  useEffect(() => {
    void useSettingsStore.getState().load()
    void useAiStore.getState().load()
    let cancelled = false
    let cleanup: (() => void) | undefined
    void useAiStore
      .getState()
      .startAiListeners()
      .then((fn) => {
        if (cancelled) fn()
        else cleanup = fn
      })
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [])

  return (
    <div className="ai-app">
      <AiSidebar />
      <div className="ai-main">
        <AiTopBar />
        <AiMessageList />
        <AiComposer />
      </div>
    </div>
  )
}
