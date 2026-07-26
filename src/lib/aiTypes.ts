export type AiModelType = 'text' | 'image' | 'audio' | 'video' | 'multimodal'

export interface AiModel {
  id: string
  remark: string
  baseUrl: string
  modelName: string
  token: string
  type: AiModelType
  active: boolean
}

export interface AiConfig {
  models: AiModel[]
  lastModelId: string | null
  lastConversationId: string | null
}

export interface AiConversation {
  id: string
  title: string
  modelId?: string
  createdAt: number
  updatedAt: number
}

export interface AiAttachment {
  kind: 'terminal-selection'
  text: string
  createdAt: number
}

export interface AiMessageStats {
  outputTokens: number
  tokensPerSec: number
  durationMs: number
  timeToFirstTokenMs?: number
  debug?: string
}

export interface AiMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoning?: string
  attachments?: AiAttachment[]
  createdAt: number
  stats?: AiMessageStats
}
