import { useEffect, useState } from 'react'
import { AiModelSettingsModal } from '../ai/AiModelSettingsModal'
import { useAiStore } from '../stores/aiStore'
import { useSettingsStore } from '../stores/settingsStore'

type AiSettingsModalProps = {
  inline?: boolean
  onClosePanel?: () => void
}

/** Hosts AI model settings from the main window (Settings → AI). */
export function AiSettingsModal({ inline, onClosePanel }: AiSettingsModalProps = {}) {
  const storeOpen = useSettingsStore((s) => s.aiSettingsOpen)
  const setAiSettingsOpen = useSettingsStore((s) => s.setAiSettingsOpen)
  const load = useAiStore((s) => s.load)
  const [ready, setReady] = useState(false)

  const isOpen = inline || storeOpen

  useEffect(() => {
    if (!isOpen) {
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
  }, [isOpen, load])

  if (!isOpen || !ready) return null

  const handleClose = () => {
    if (inline) {
      onClosePanel?.()
    } else {
      setAiSettingsOpen(false)
    }
  }

  return <AiModelSettingsModal onClose={handleClose} inline={inline} />
}
