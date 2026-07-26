import { useEffect, useState } from 'react'
import { AiModelSettingsModal } from '../ai/AiModelSettingsModal'
import { useAiStore } from '../stores/aiStore'
import { useSettingsStore } from '../stores/settingsStore'

/** Hosts AI model settings from the main window (Settings → AI). */
export function AiSettingsModal() {
  const open = useSettingsStore((s) => s.aiSettingsOpen)
  const setAiSettingsOpen = useSettingsStore((s) => s.setAiSettingsOpen)
  const load = useAiStore((s) => s.load)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!open) {
      setReady(false)
      return
    }
    let cancelled = false
    setReady(false)
    void load().finally(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [open, load])

  if (!open || !ready) return null

  return <AiModelSettingsModal onClose={() => setAiSettingsOpen(false)} />
}
