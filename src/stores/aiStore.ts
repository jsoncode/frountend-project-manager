import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import type {
  AiAttachment,
  AiConfig,
  AiConversation,
  AiMessage,
  AiModel,
} from '../lib/aiTypes'
import { isTauri } from '../lib/tauri'

const EMPTY_CONFIG: AiConfig = {
  models: [],
  lastModelId: null,
}

function normalizeConfig(cfg: AiConfig | null | undefined): AiConfig {
  return {
    models: cfg?.models ?? [],
    lastModelId: cfg?.lastModelId ?? null,
  }
}

function pickSelectedModelId(cfg: AiConfig): string | null {
  const active = cfg.models.filter((m) => m.active)
  if (cfg.lastModelId && active.some((m) => m.id === cfg.lastModelId)) {
    return cfg.lastModelId
  }
  return active[0]?.id ?? null
}

type AiState = {
  config: AiConfig
  selectedModelId: string | null
  streamEnabled: boolean
  thinkEnabled: boolean
  codeEnabled: boolean
  pendingAttachment: AiAttachment | null
  conversations: AiConversation[]
  messages: AiMessage[]
  activeConversationId: string | null
  loading: boolean
  error: string | null
  load: () => Promise<void>
  saveConfig: (cfg: AiConfig) => Promise<void>
  setSelectedModelId: (id: string | null) => void
  activeModels: () => AiModel[]
  setStreamEnabled: (v: boolean) => void
  setThinkEnabled: (v: boolean) => void
  setCodeEnabled: (v: boolean) => void
  setAttachment: (attachment: AiAttachment | null) => void
  clearAttachment: () => void
}

export const useAiStore = create<AiState>((set, get) => ({
  config: { ...EMPTY_CONFIG },
  selectedModelId: null,
  streamEnabled: true,
  thinkEnabled: false,
  codeEnabled: false,
  pendingAttachment: null,
  conversations: [],
  messages: [],
  activeConversationId: null,
  loading: false,
  error: null,

  activeModels: () => get().config.models.filter((m) => m.active),

  load: async () => {
    set({ loading: true, error: null })
    if (!isTauri()) {
      set({
        loading: false,
        config: EMPTY_CONFIG,
        selectedModelId: null,
        error: null,
      })
      return
    }
    try {
      const raw = await invoke<AiConfig>('ai_load_config')
      const config = normalizeConfig(raw)
      set({
        config,
        selectedModelId: pickSelectedModelId(config),
        loading: false,
        error: null,
      })
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
        config: EMPTY_CONFIG,
        selectedModelId: null,
      })
      console.warn('ai_load_config failed', e)
    }
  },

  saveConfig: async (cfg) => {
    const normalized = normalizeConfig(cfg)
    const selectedModelId = pickSelectedModelId(normalized)
    const next: AiConfig = { ...normalized, lastModelId: selectedModelId }
    if (!isTauri()) {
      set({ config: next, selectedModelId })
      return
    }
    const saved = normalizeConfig(
      await invoke<AiConfig>('ai_save_config', { cfg: next }),
    )
    const id = pickSelectedModelId(saved)
    set({
      config: { ...saved, lastModelId: id },
      selectedModelId: id,
      error: null,
    })
  },

  setSelectedModelId: (id) => {
    const current = get().config
    const next: AiConfig = { ...current, lastModelId: id }
    set({ selectedModelId: id, config: next })
    void get()
      .saveConfig(next)
      .catch((e) => {
        console.warn('persist lastModelId failed', e)
      })
  },

  setStreamEnabled: (v) => set({ streamEnabled: v }),
  setThinkEnabled: (v) => set({ thinkEnabled: v }),
  setCodeEnabled: (v) => set({ codeEnabled: v }),
  setAttachment: (attachment) => set({ pendingAttachment: attachment }),
  clearAttachment: () => set({ pendingAttachment: null }),
}))
