import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { create } from 'zustand'
import {
  buildUserContent,
  defaultConversationTitle,
  PROGRAMMING_SYSTEM_PROMPT,
  truncateAttachment,
} from '../lib/aiChat'
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

type ApiChatMessage = { role: string; content: string }

type ChatChunkEvent = {
  requestId: string
  delta?: string | null
  reasoningDelta?: string | null
  done: boolean
  error?: string | null
}

let unlistenChunk: UnlistenFn | null = null
let unlistenFeed: UnlistenFn | null = null

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

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
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
  generating: boolean
  activeRequestId: string | null
  streamingAssistantId: string | null
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
  loadConversations: () => Promise<void>
  selectConversation: (id: string | null) => Promise<void>
  createConversation: (title?: string) => Promise<AiConversation | null>
  renameConversation: (id: string, title: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  sendMessage: (userText: string) => Promise<void>
  stopGeneration: () => Promise<void>
  startAiListeners: () => Promise<() => void>
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
  generating: false,
  activeRequestId: null,
  streamingAssistantId: null,
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
        conversations: [],
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
      await get().loadConversations()
    } catch (e) {
      set({
        loading: false,
        error: errMsg(e),
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

  loadConversations: async () => {
    if (!isTauri()) {
      set({ conversations: [] })
      return
    }
    try {
      const list = await invoke<AiConversation[]>('ai_list_conversations')
      set({ conversations: list })
    } catch (e) {
      set({ error: errMsg(e) })
      console.warn('ai_list_conversations failed', e)
    }
  },

  selectConversation: async (id) => {
    if (!id) {
      set({ activeConversationId: null, messages: [], error: null })
      return
    }
    if (!isTauri()) {
      set({ activeConversationId: id, messages: [], error: null })
      return
    }
    try {
      const messages = await invoke<AiMessage[]>('ai_get_messages', {
        conversationId: id,
      })
      set({
        activeConversationId: id,
        messages,
        error: null,
      })
    } catch (e) {
      set({ error: errMsg(e) })
      console.warn('ai_get_messages failed', e)
    }
  },

  createConversation: async (title) => {
    if (!isTauri()) {
      const now = Date.now()
      const conv: AiConversation = {
        id: crypto.randomUUID(),
        title: title?.trim() || '新对话',
        createdAt: now,
        updatedAt: now,
      }
      set((s) => ({
        conversations: [conv, ...s.conversations],
        activeConversationId: conv.id,
        messages: [],
        error: null,
      }))
      return conv
    }
    try {
      const conv = await invoke<AiConversation>('ai_create_conversation', {
        title: title?.trim() ? title.trim() : null,
      })
      set((s) => ({
        conversations: [conv, ...s.conversations.filter((c) => c.id !== conv.id)],
        activeConversationId: conv.id,
        messages: [],
        error: null,
      }))
      return conv
    } catch (e) {
      set({ error: errMsg(e) })
      console.warn('ai_create_conversation failed', e)
      return null
    }
  },

  renameConversation: async (id, title) => {
    const trimmed = title.trim()
    if (!trimmed) return
    if (!isTauri()) {
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === id ? { ...c, title: trimmed, updatedAt: Date.now() } : c,
        ),
      }))
      return
    }
    try {
      const updated = await invoke<AiConversation>('ai_rename_conversation', {
        id,
        title: trimmed,
      })
      set((s) => ({
        conversations: s.conversations.map((c) => (c.id === id ? updated : c)),
        error: null,
      }))
    } catch (e) {
      set({ error: errMsg(e) })
      console.warn('ai_rename_conversation failed', e)
    }
  },

  deleteConversation: async (id) => {
    if (!isTauri()) {
      set((s) => {
        const conversations = s.conversations.filter((c) => c.id !== id)
        const clearing = s.activeConversationId === id
        return {
          conversations,
          activeConversationId: clearing ? null : s.activeConversationId,
          messages: clearing ? [] : s.messages,
        }
      })
      return
    }
    try {
      await invoke('ai_delete_conversation', { id })
      set((s) => {
        const conversations = s.conversations.filter((c) => c.id !== id)
        const clearing = s.activeConversationId === id
        return {
          conversations,
          activeConversationId: clearing ? null : s.activeConversationId,
          messages: clearing ? [] : s.messages,
          error: null,
        }
      })
    } catch (e) {
      set({ error: errMsg(e) })
      console.warn('ai_delete_conversation failed', e)
    }
  },

  sendMessage: async (userText) => {
    const text = userText.trim()
    const state = get()
    if (!text || state.generating) return

    const modelId = state.selectedModelId
    const model = state.config.models.find((m) => m.id === modelId)
    if (!model || !model.active) {
      set({ error: 'ai.error.noModel' })
      return
    }
    if (model.type !== 'text' && model.type !== 'multimodal') {
      set({ error: 'ai.error.unsupportedModel' })
      return
    }

    let conversationId = state.activeConversationId
    if (!conversationId) {
      const conv = await get().createConversation(defaultConversationTitle(text))
      if (!conv) return
      conversationId = conv.id
    }

    const attachment = get().pendingAttachment
    const userContent = buildUserContent(text, attachment)
    const history = get().messages.filter(
      (m) => m.role === 'user' || m.role === 'assistant',
    )

    const apiMessages: ApiChatMessage[] = []
    if (get().codeEnabled) {
      apiMessages.push({
        role: 'system',
        content: PROGRAMMING_SYSTEM_PROMPT,
      })
    }
    for (const m of history) {
      apiMessages.push({ role: m.role, content: m.content })
    }
    apiMessages.push({ role: 'user', content: userContent })

    const now = Date.now()
    const userMsg: AiMessage = {
      id: crypto.randomUUID(),
      conversationId,
      role: 'user',
      content: userContent,
      attachments: attachment ? [attachment] : undefined,
      createdAt: now,
    }

    const requestId = crypto.randomUUID()
    const assistantId = `pending-${requestId}`
    const assistantPlaceholder: AiMessage = {
      id: assistantId,
      conversationId,
      role: 'assistant',
      content: '',
      createdAt: now + 1,
    }

    try {
      if (isTauri()) {
        const savedUser = await invoke<AiMessage>('ai_append_message', {
          msg: userMsg,
        })
        set((s) => ({
          messages: [...s.messages, savedUser, assistantPlaceholder],
          generating: true,
          activeRequestId: requestId,
          streamingAssistantId: assistantId,
          error: null,
          conversations: s.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, updatedAt: Date.now(), modelId: modelId ?? c.modelId }
              : c,
          ),
        }))
        get().clearAttachment()
        await invoke('ai_chat_start', {
          req: {
            requestId,
            modelId,
            messages: apiMessages,
            stream: get().streamEnabled,
          },
        })
        void get().loadConversations()
      } else {
        set((s) => ({
          messages: [...s.messages, userMsg, assistantPlaceholder],
          generating: true,
          activeRequestId: requestId,
          streamingAssistantId: assistantId,
          error: null,
        }))
        get().clearAttachment()
        set({
          generating: false,
          activeRequestId: null,
          streamingAssistantId: null,
          error: 'ai.error.tauriOnly',
        })
      }
    } catch (e) {
      set({
        generating: false,
        activeRequestId: null,
        streamingAssistantId: null,
        error: errMsg(e),
      })
      console.warn('sendMessage failed', e)
    }
  },

  stopGeneration: async () => {
    const requestId = get().activeRequestId
    if (!requestId) return
    if (!isTauri()) {
      set({ generating: false, activeRequestId: null })
      return
    }
    try {
      await invoke('ai_chat_cancel', { requestId })
    } catch (e) {
      console.warn('ai_chat_cancel failed', e)
    }
  },

  startAiListeners: async () => {
    const cleanup = () => {
      void unlistenChunk?.()
      void unlistenFeed?.()
      unlistenChunk = null
      unlistenFeed = null
    }

    if (!isTauri()) {
      return cleanup
    }

    cleanup()

    unlistenChunk = await listen<ChatChunkEvent>('ai://chat-chunk', (event) => {
      const chunk = event.payload
      const {
        activeRequestId,
        streamingAssistantId,
        generating,
        activeConversationId,
      } = get()
      if (!generating || !activeRequestId || chunk.requestId !== activeRequestId) {
        return
      }

      if (chunk.error) {
        set({
          error: chunk.error,
          generating: false,
          activeRequestId: null,
        })
      }

      if (chunk.delta || chunk.reasoningDelta) {
        const delta = chunk.delta ?? ''
        const reasoningDelta = chunk.reasoningDelta ?? ''
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== streamingAssistantId) return m
            return {
              ...m,
              content: delta ? m.content + delta : m.content,
              reasoning:
                reasoningDelta
                  ? `${m.reasoning ?? ''}${reasoningDelta}`
                  : m.reasoning,
            }
          }),
        }))
      }

      if (chunk.done) {
        const assistant = get().messages.find((m) => m.id === streamingAssistantId)
        const convId = activeConversationId
        const placeholderId = streamingAssistantId

        void (async () => {
          try {
            if (
              assistant &&
              convId &&
              isTauri() &&
              (assistant.content || assistant.reasoning)
            ) {
              const toSave: AiMessage = {
                id: crypto.randomUUID(),
                conversationId: convId,
                role: 'assistant',
                content: assistant.content,
                reasoning: assistant.reasoning,
                createdAt: assistant.createdAt,
              }
              const saved = await invoke<AiMessage>('ai_append_message', {
                msg: toSave,
              })
              set((s) => ({
                messages: s.messages.map((m) =>
                  m.id === placeholderId ? saved : m,
                ),
                generating: false,
                activeRequestId: null,
                streamingAssistantId: null,
              }))
              void get().loadConversations()
            } else {
              set({
                generating: false,
                activeRequestId: null,
                streamingAssistantId: null,
              })
            }
          } catch (e) {
            set({
              generating: false,
              activeRequestId: null,
              streamingAssistantId: null,
              error: errMsg(e),
            })
            console.warn('persist assistant failed', e)
          }
        })()
      }
    })

    unlistenFeed = await listen<string>('ai://feed', (event) => {
      const text = truncateAttachment(String(event.payload ?? ''))
      if (!text) return
      get().setAttachment({
        kind: 'terminal-selection',
        text,
        createdAt: Date.now(),
      })
    })

    try {
      const pending = await invoke<string | null>('ai_take_pending_feed')
      if (pending) {
        get().setAttachment({
          kind: 'terminal-selection',
          text: truncateAttachment(pending),
          createdAt: Date.now(),
        })
      }
    } catch (e) {
      console.warn('ai_take_pending_feed failed', e)
    }

    return cleanup
  },
}))
