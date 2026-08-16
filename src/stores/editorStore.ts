import { create } from '../lib/createStore'
import { normalizeFsPath } from '../lib/gitDecorations'

export type EditorTab = {
  path: string
  projectPath: string
}

export type EditorDoc = {
  baseline: string
  value: string
  status: 'loading' | 'ready' | 'error'
  error?: string
}

type EditorUiState = {
  tabs: EditorTab[]
  activePath: string | null
  /** Documents keyed by normalized path */
  docs: Record<string, EditorDoc>
  openTab: (path: string, projectPath: string) => void
  activateTab: (path: string) => void
  /** Remove a tab. Returns false if dirty and caller should confirm first. */
  closeTab: (path: string) => void
  isTabDirty: (path: string) => boolean
  setDocLoading: (path: string) => void
  setDocReady: (path: string, content: string) => void
  setDocError: (path: string, message: string) => void
  setDocValue: (path: string, value: string) => void
  markDocSaved: (path: string) => void
  getDoc: (path: string) => EditorDoc | undefined
}

export function editorPathKey(path: string): string {
  return normalizeFsPath(path)
}

function findTabIndex(tabs: EditorTab[], path: string): number {
  const key = editorPathKey(path)
  return tabs.findIndex((t) => editorPathKey(t.path) === key)
}

export const useEditorStore = create<EditorUiState>((set, get) => ({
  tabs: [],
  activePath: null,
  docs: {},

  openTab: (path, projectPath) => {
    const tabs = get().tabs
    const idx = findTabIndex(tabs, path)
    if (idx >= 0) {
      const existing = tabs[idx]!
      set({
        activePath: existing.path,
        tabs:
          existing.projectPath === projectPath
            ? tabs
            : tabs.map((t, i) =>
                i === idx ? { ...t, projectPath } : t,
              ),
      })
      return
    }
    set({
      tabs: [...tabs, { path, projectPath }],
      activePath: path,
    })
  },

  activateTab: (path) => {
    const idx = findTabIndex(get().tabs, path)
    if (idx < 0) return
    set({ activePath: get().tabs[idx]!.path })
  },

  closeTab: (path) => {
    const { tabs, activePath, docs } = get()
    const idx = findTabIndex(tabs, path)
    if (idx < 0) return
    const nextTabs = tabs.filter((_, i) => i !== idx)
    const nextDocs = { ...docs }
    delete nextDocs[editorPathKey(tabs[idx]!.path)]

    let nextActive = activePath
    if (
      activePath &&
      editorPathKey(activePath) === editorPathKey(path)
    ) {
      const neighbor = nextTabs[idx] ?? nextTabs[idx - 1] ?? null
      nextActive = neighbor?.path ?? null
    }

    set({
      tabs: nextTabs,
      activePath: nextActive,
      docs: nextDocs,
    })
  },

  isTabDirty: (path) => {
    const doc = get().docs[editorPathKey(path)]
    return Boolean(
      doc && doc.status === 'ready' && doc.value !== doc.baseline,
    )
  },

  setDocLoading: (path) => {
    const key = editorPathKey(path)
    set({
      docs: {
        ...get().docs,
        [key]: {
          baseline: '',
          value: '',
          status: 'loading',
        },
      },
    })
  },

  setDocReady: (path, content) => {
    const key = editorPathKey(path)
    set({
      docs: {
        ...get().docs,
        [key]: {
          baseline: content,
          value: content,
          status: 'ready',
        },
      },
    })
  },

  setDocError: (path, message) => {
    const key = editorPathKey(path)
    set({
      docs: {
        ...get().docs,
        [key]: {
          baseline: '',
          value: '',
          status: 'error',
          error: message,
        },
      },
    })
  },

  setDocValue: (path, value) => {
    const key = editorPathKey(path)
    const prev = get().docs[key]
    if (!prev || prev.status !== 'ready') return
    set({
      docs: { ...get().docs, [key]: { ...prev, value } },
    })
  },

  markDocSaved: (path) => {
    const key = editorPathKey(path)
    const prev = get().docs[key]
    if (!prev || prev.status !== 'ready') return
    set({
      docs: {
        ...get().docs,
        [key]: { ...prev, baseline: prev.value },
      },
    })
  },

  getDoc: (path) => get().docs[editorPathKey(path)],
}))
