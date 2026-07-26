import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { create } from '../lib/createStore'
import {
  buildUserContent,
  defaultConversationTitle,
  estimateTokens,
  formatDuration,
  PROGRAMMING_SYSTEM_PROMPT,
  truncateAttachment,
} from '../lib/aiChat'
import type {
  AiAttachment,
  AiConfig,
  AiConversation,
  AiMessage,
  AiMessageStats,
  AiModel,
} from '../lib/aiTypes'
import { isTauri } from '../lib/tauri'

const EMPTY_CONFIG: AiConfig = {
  models: [],
  lastModelId: null,
  lastConversationId: null,
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
let streamStartedAt = 0
let firstTokenAt: number | null = null

function normalizeConfig(cfg: AiConfig | null | undefined): AiConfig {
  return {
    models: cfg?.models ?? [],
    lastModelId: cfg?.lastModelId ?? null,
    lastConversationId: cfg?.lastConversationId ?? null,
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

function buildLiveStats(
  content: string,
  reasoning: string | undefined,
  modelLabel: string,
  requestId: string,
  streamed: boolean,
): AiMessageStats {
  const now = Date.now()
  const started = streamStartedAt || now
  const durationMs = Math.max(0, now - started)
  const outputTokens = estimateTokens(
    `${content}${reasoning ? `\n${reasoning}` : ''}`,
  )
  const secs = durationMs / 1000
  const tokensPerSec = secs > 0 ? outputTokens / secs : 0
  const ttft =
    firstTokenAt != null ? Math.max(0, firstTokenAt - started) : undefined
  const debugParts = [
    `model=${modelLabel || '—'}`,
    streamed ? 'stream' : 'non-stream',
    `req=${requestId.slice(0, 8)}`,
  ]
  if (ttft != null) debugParts.push(`ttft=${formatDuration(ttft)}`)
  debugParts.push(`out≈${outputTokens}`)
  return {
    outputTokens,
    tokensPerSec,
    durationMs,
    timeToFirstTokenMs: ttft,
    debug: debugParts.join(' · '),
  }
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
  generateTitleFromFirstMessage: (
    id: string,
    userText: string,
    modelId: string,
  ) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  deleteMessage: (id: string) => Promise<void>
  updateMessageContent: (id: string, content: string) => Promise<void>
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
      const { config: loadedCfg, conversations } = get()
      const lastId = loadedCfg.lastConversationId
      const restoreId =
        (lastId && conversations.some((c) => c.id === lastId) ? lastId : null) ??
        conversations[0]?.id ??
        null
      if (restoreId) {
        await get().selectConversation(restoreId)
      }
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
      void get()
        .saveConfig({ ...get().config, lastConversationId: null })
        .catch((e) => console.warn('persist lastConversationId failed', e))
      return
    }
    if (!isTauri()) {
      set((s) => ({
        activeConversationId: id,
        messages: [],
        error: null,
        config: { ...s.config, lastConversationId: id },
      }))
      return
    }
    try {
      const messages = await invoke<AiMessage[]>('ai_get_messages', {
        conversationId: id,
      })
      set((s) => ({
        activeConversationId: id,
        messages,
        error: null,
        config: { ...s.config, lastConversationId: id },
      }))
      void invoke('ai_save_config', { cfg: get().config }).catch((e) =>
        console.warn('persist lastConversationId failed', e),
      )
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
        config: { ...s.config, lastConversationId: conv.id },
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
        config: { ...s.config, lastConversationId: conv.id },
      }))
      void invoke('ai_save_config', { cfg: get().config }).catch((e) =>
        console.warn('persist lastConversationId failed', e),
      )
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
      console.warn('ai_rename_conversation failed', e)
    }
  },

  generateTitleFromFirstMessage: async (id, userText, modelId) => {
    if (!isTauri() || !modelId) {
      await get().renameConversation(id, defaultConversationTitle(userText))
      return
    }
    try {
      const title = await invoke<string>('ai_generate_title', {
        modelId,
        userMessage: userText,
      })
      const next = title.trim() || defaultConversationTitle(userText)
      await get().renameConversation(id, next)
    } catch (e) {
      console.warn('ai_generate_title failed', e)
      await get().renameConversation(id, defaultConversationTitle(userText))
    }
  },

  deleteConversation: async (id) => {
    if (!isTauri()) {
      const conversations = get().conversations.filter((c) => c.id !== id)
      const clearing = get().activeConversationId === id
      const nextActive = clearing
        ? (conversations[0]?.id ?? null)
        : get().activeConversationId
      set((s) => ({
        conversations,
        activeConversationId: nextActive,
        messages: clearing ? [] : s.messages,
        config: { ...s.config, lastConversationId: nextActive },
      }))
      return
    }
    try {
      await invoke('ai_delete_conversation', { id })
      const conversations = get().conversations.filter((c) => c.id !== id)
      const clearing = get().activeConversationId === id
      const nextActive = clearing
        ? (conversations[0]?.id ?? null)
        : get().activeConversationId
      set({ conversations, error: null })
      if (clearing) {
        await get().selectConversation(nextActive)
      }
    } catch (e) {
      set({ error: errMsg(e) })
      console.warn('ai_delete_conversation failed', e)
    }
  },

  deleteMessage: async (id) => {
    if (!isTauri()) {
      set((s) => {
        const idx = s.messages.findIndex((m) => m.id === id)
        if (idx < 0) return s
        const removeIds = new Set<string>([id])
        const cur = s.messages[idx]!
        if (cur.role === 'user') {
          const next = s.messages[idx + 1]
          if (next?.role === 'assistant') removeIds.add(next.id)
        }
        return {
          messages: s.messages.filter((m) => !removeIds.has(m.id)),
        }
      })
      return
    }
    try {
      const deleted = await invoke<string[]>('ai_delete_message', { id })
      const removeIds = new Set(deleted)
      set((s) => ({
        messages: s.messages.filter((m) => !removeIds.has(m.id)),
      }))
    } catch (e) {
      set({ error: errMsg(e) })
      console.warn('ai_delete_message failed', e)
    }
  },

  updateMessageContent: async (id, content) => {
    const trimmed = content
    if (!isTauri()) {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === id ? { ...m, content: trimmed } : m,
        ),
      }))
      return
    }
    try {
      const updated = await invoke<AiMessage>('ai_update_message', {
        id,
        content: trimmed,
      })
      set((s) => ({
        messages: s.messages.map((m) => (m.id === id ? updated : m)),
      }))
    } catch (e) {
      set({ error: errMsg(e) })
      console.warn('ai_update_message failed', e)
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
    const isFirstUserTurn =
      get().messages.filter((m) => m.role === 'user').length === 0
    if (!conversationId) {
      const conv = await get().createConversation()
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
    streamStartedAt = Date.now()
    firstTokenAt = null

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
        if (isFirstUserTurn && modelId) {
          void get().generateTitleFromFirstMessage(
            conversationId,
            text,
            modelId,
          )
        }
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

      const thinkEnabled = get().thinkEnabled
      const delta = chunk.delta ?? ''
      const reasoningDelta =
        thinkEnabled && chunk.reasoningDelta ? chunk.reasoningDelta : ''
      if (delta || reasoningDelta) {
        if (firstTokenAt == null) firstTokenAt = Date.now()
        const model = get().config.models.find(
          (m) => m.id === get().selectedModelId,
        )
        const modelLabel =
          model?.remark.trim() || model?.modelName || model?.id || '—'
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== streamingAssistantId) return m
            const content = delta ? m.content + delta : m.content
            const reasoning = reasoningDelta
              ? `${m.reasoning ?? ''}${reasoningDelta}`
              : m.reasoning
            return {
              ...m,
              content,
              reasoning,
              stats: buildLiveStats(
                content,
                reasoning,
                modelLabel,
                activeRequestId,
                get().streamEnabled,
              ),
            }
          }),
        }))
      }

      if (chunk.done) {
        const assistant = get().messages.find((m) => m.id === streamingAssistantId)
        const convId = activeConversationId
        const placeholderId = streamingAssistantId
        const model = get().config.models.find(
          (m) => m.id === get().selectedModelId,
        )
        const modelLabel =
          model?.remark.trim() || model?.modelName || model?.id || '—'
        const finalStats =
          assistant && activeRequestId
            ? buildLiveStats(
                assistant.content,
                assistant.reasoning,
                modelLabel,
                activeRequestId,
                get().streamEnabled,
              )
            : assistant?.stats

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
                stats: finalStats,
              }
              const saved = await invoke<AiMessage>('ai_append_message', {
                msg: toSave,
              })
              set((s) => ({
                messages: s.messages.map((m) =>
                  m.id === placeholderId ? { ...saved, stats: finalStats } : m,
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
