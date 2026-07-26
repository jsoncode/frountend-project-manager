import { create } from '../lib/createStore'

type ErrorLogState = {
  title: string | null
  message: string | null
  show: (message: string, title?: string) => void
  clear: () => void
}

export const useErrorLogStore = create<ErrorLogState>((set) => ({
  title: null,
  message: null,
  show: (message, title) =>
    set({
      message: message.trim() || message,
      title: title?.trim() || null,
    }),
  clear: () => set({ title: null, message: null }),
}))

export function showErrorLog(message: unknown, title?: string) {
  const text =
    message instanceof Error
      ? message.message
      : typeof message === 'string'
        ? message
        : String(message)
  useErrorLogStore.getState().show(text, title)
}
