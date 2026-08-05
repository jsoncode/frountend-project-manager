import { invoke } from '@tauri-apps/api/core'
import { create } from '../lib/createStore'
import { isTauri } from '../lib/tauri'
import type { AppConfig, EditorThemeId, IdeConfig } from '../lib/types'

type HistoryKind = 'command' | 'branch' | 'search'

const EMPTY_CONFIG: AppConfig = {
  workspaces: [],
  tags: {},
  ides: [],
  commandHistory: {},
  branchHistory: {},
  branchFavorites: {},
  searchHistory: [],
  projectAccess: {},
  locale: 'zh',
  editorTheme: 'vs-dark',
}

const EMPTY_HISTORY = EMPTY_CONFIG.searchHistory
const EMPTY_IDES = EMPTY_CONFIG.ides
const EMPTY_CMD_HISTORY = EMPTY_CONFIG.commandHistory
const EMPTY_BRANCH_HISTORY = EMPTY_CONFIG.branchHistory
const EMPTY_BRANCH_FAVORITES = EMPTY_CONFIG.branchFavorites
const EMPTY_ACCESS = EMPTY_CONFIG.projectAccess

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForTauri(timeoutMs = 4000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (isTauri()) return true
    await sleep(40)
  }
  return isTauri()
}

async function invokeLoadConfig(): Promise<AppConfig> {
  let last: unknown
  for (let i = 0; i < 10; i++) {
    try {
      return await invoke<AppConfig>('load_config')
    } catch (e) {
      last = e
      await sleep(60 + i * 40)
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

function normalizeConfig(cfg: AppConfig): AppConfig {
  return {
    ...EMPTY_CONFIG,
    ...cfg,
    tags: {},
    ides: cfg.ides ?? EMPTY_IDES,
    commandHistory: cfg.commandHistory ?? EMPTY_CMD_HISTORY,
    branchHistory: cfg.branchHistory ?? EMPTY_BRANCH_HISTORY,
    branchFavorites: cfg.branchFavorites ?? EMPTY_BRANCH_FAVORITES,
    searchHistory: cfg.searchHistory ?? EMPTY_HISTORY,
    projectAccess: cfg.projectAccess ?? EMPTY_ACCESS,
    locale: cfg.locale === 'en' ? 'en' : 'zh',
    editorTheme: cfg.editorTheme ?? 'vs-dark',
  }
}

type SettingsState = {
  config: AppConfig | null
  loading: boolean
  error: string | null
  ideModalOpen: boolean
  aiSettingsOpen: boolean
  jenCliModalOpen: boolean
  settingsOpen: boolean
  load: () => Promise<void>
  saveWorkspaces: (workspaces: string[]) => Promise<void>
  saveIdes: (ides: IdeConfig[]) => Promise<void>
  touchCommandHistory: (projectPath: string, command: string) => Promise<void>
  touchBranchHistory: (projectPath: string, branch: string) => Promise<void>
  touchSearchHistory: (query: string) => Promise<void>
  touchProjectAccess: (projectPath: string) => Promise<void>
  setHistoryPinned: (
    projectPath: string,
    kind: HistoryKind,
    value: string,
    pinned: boolean,
  ) => Promise<void>
  deleteHistory: (
    projectPath: string,
    kind: HistoryKind,
    value: string,
  ) => Promise<void>
  clearProjectCache: () => Promise<void>
  clearAiConversations: () => Promise<void>
  setLocale: (locale: 'zh' | 'en') => Promise<void>
  setEditorTheme: (themeId: EditorThemeId) => Promise<void>
  setIdeModalOpen: (open: boolean) => void
  setAiSettingsOpen: (open: boolean) => void
  setJenCliModalOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  applyConfig: (cfg: AppConfig) => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  // Start with a real config object so selectors never need `?? []` fallbacks.
  config: { ...EMPTY_CONFIG },
  loading: false,
  error: null,
  ideModalOpen: false,
  aiSettingsOpen: false,
  jenCliModalOpen: false,
  settingsOpen: false,
  applyConfig: (cfg) => set({ config: cfg }),
  setIdeModalOpen: (open) => set({ ideModalOpen: open }),
  setAiSettingsOpen: (open) => set({ aiSettingsOpen: open }),
  setJenCliModalOpen: (open) => set({ jenCliModalOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  load: async () => {
    set({ loading: true, error: null })
    const ready = await waitForTauri()
    if (!ready) {
      // Browser preview only — not a real install failure.
      set({
        loading: false,
        config: EMPTY_CONFIG,
        error: null,
      })
      return
    }
    try {
      const cfg = await invokeLoadConfig()
      set({
        config: normalizeConfig(cfg),
        loading: false,
        error: null,
      })
    } catch (e) {
      // Keep UI usable; avoid sticky "加载失败" on first-launch races.
      set({
        loading: false,
        error: null,
        config: EMPTY_CONFIG,
      })
      console.warn('load_config failed after retries', e)
    }
  },
  saveWorkspaces: async (workspaces) => {
    const current = get().config
    if (!current) return
    const next = { ...current, workspaces }
    await invoke('save_config', { cfg: next })
    set({ config: next })
  },
  saveIdes: async (ides) => {
    const cfg = await invoke<AppConfig>('save_ides', { ides })
    set({ config: cfg })
  },
  touchCommandHistory: async (projectPath, command) => {
    if (!isTauri()) return
    const cfg = await invoke<AppConfig>('touch_command_history', {
      projectPath,
      command,
    })
    set({ config: cfg })
  },
  touchBranchHistory: async (projectPath, branch) => {
    if (!isTauri()) return
    const cfg = await invoke<AppConfig>('touch_branch_history', {
      projectPath,
      branch,
    })
    set({ config: cfg })
  },
  touchSearchHistory: async (query) => {
    const q = query.trim()
    if (!q) return
    if (!isTauri()) {
      const current = get().config
      if (!current) return
      const now = Date.now()
      const prev = current.searchHistory ?? []
      const existing = prev.find((i) => i.value === q)
      const nextItem = existing
        ? { ...existing, count: existing.count + 1, lastUsedAt: now }
        : { value: q, count: 1, lastUsedAt: now, pinned: false }
      const rest = prev.filter((i) => i.value !== q)
      set({
        config: {
          ...current,
          searchHistory: [nextItem, ...rest].slice(0, 40),
        },
      })
      return
    }
    const cfg = await invoke<AppConfig>('touch_search_history', { query: q })
    set({ config: cfg })
  },
  touchProjectAccess: async (projectPath) => {
    if (!isTauri()) {
      const current = get().config
      if (!current) return
      set({
        config: {
          ...current,
          projectAccess: {
            ...(current.projectAccess ?? {}),
            [projectPath]: Date.now(),
          },
        },
      })
      return
    }
    const cfg = await invoke<AppConfig>('touch_project_access', { projectPath })
    set({ config: cfg })
  },
  setHistoryPinned: async (projectPath, kind, value, pinned) => {
    const cfg = await invoke<AppConfig>('set_history_pinned', {
      projectPath,
      kind,
      value,
      pinned,
    })
    set({ config: cfg })
  },
  deleteHistory: async (projectPath, kind, value) => {
    const cfg = await invoke<AppConfig>('delete_history', {
      projectPath,
      kind,
      value,
    })
    set({ config: cfg })
  },
  clearProjectCache: async () => {
    await invoke('clear_all_project_cache')
    await get().load()
  },
  clearAiConversations: async () => {
    await invoke('clear_all_ai_conversations')
  },
  setLocale: async (locale) => {
    if (!isTauri()) {
      const current = get().config
      if (current) set({ config: { ...current, locale } })
      return
    }
    const cfg = await invoke<AppConfig>('set_locale', { locale })
    set({ config: { ...cfg, locale: cfg.locale === 'en' ? 'en' : 'zh' } })
  },
  setEditorTheme: async (themeId) => {
    const current = get().config
    if (!current) return
    const next = { ...current, editorTheme: themeId }
    if (isTauri()) {
      const cfg = await invoke<AppConfig>('save_config', { cfg: next })
      set({ config: cfg })
    } else {
      set({ config: next })
    }
  },
}))
