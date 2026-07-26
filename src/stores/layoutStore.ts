import { invoke } from '@tauri-apps/api/core'
import { create } from '../lib/createStore'

export type SideTool = 'ide' | 'cmd' | 'git' | 'env' | 'meta'
export type ToolLayoutMode = 'single' | 'stack'

export const TOOL_ORDER: SideTool[] = ['ide', 'cmd', 'git', 'env', 'meta']

type LayoutPersist = {
  railWidth: number
  listWidth: number
  toolPanelWidth: number
  terminalHeight: number
  toolLayoutMode: ToolLayoutMode
  openTools: SideTool[]
}

type LayoutState = LayoutPersist & {
  hydrated: boolean
  setRailWidth: (n: number) => void
  setListWidth: (n: number) => void
  setToolPanelWidth: (n: number) => void
  setTerminalHeight: (n: number) => void
  setToolLayoutMode: (mode: ToolLayoutMode) => void
  toggleSideTool: (tool: SideTool) => void
  closeSideTool: (tool: SideTool) => void
  hydrate: () => Promise<void>
  persist: () => void
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function num(v: unknown, fallback: number) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function isSideTool(v: unknown): v is SideTool {
  return v === 'ide' || v === 'cmd' || v === 'git' || v === 'env' || v === 'meta'
}

function parseMode(v: unknown): ToolLayoutMode {
  return v === 'stack' ? 'stack' : 'single'
}

function parseOpenTools(v: unknown, mode: ToolLayoutMode): SideTool[] {
  if (Array.isArray(v)) {
    const list = v.filter(isSideTool)
    if (mode === 'single') return list.slice(0, 1)
    return TOOL_ORDER.filter((id) => list.includes(id))
  }
  return ['cmd']
}

function fromLocalStorage(): LayoutPersist | null {
  try {
    const rawV4 = localStorage.getItem('fpm.layout.v4')
    if (rawV4) {
      const o = JSON.parse(rawV4) as Record<string, unknown>
      const mode = parseMode(o.toolLayoutMode)
      return {
        railWidth: num(o.railWidth, 240),
        listWidth: num(o.listWidth, 280),
        toolPanelWidth: num(o.toolPanelWidth, 300),
        terminalHeight: num(o.terminalHeight, 220),
        toolLayoutMode: mode,
        openTools: parseOpenTools(o.openTools, mode),
      }
    }
    const rawV3 = localStorage.getItem('fpm.layout.v3')
    if (rawV3) {
      const o = JSON.parse(rawV3) as {
        railWidth?: number
        listWidth?: number
        toolPanelWidth?: number
        terminalHeight?: number
        sideTool?: unknown
      }
      const side = isSideTool(o.sideTool)
        ? o.sideTool
        : o.sideTool === null
          ? null
          : 'cmd'
      return {
        railWidth: num(o.railWidth, 240),
        listWidth: num(o.listWidth, 280),
        toolPanelWidth: num(o.toolPanelWidth, 300),
        terminalHeight: num(o.terminalHeight, 220),
        toolLayoutMode: 'single',
        openTools: side ? [side] : [],
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

function snapshot(s: LayoutPersist) {
  return {
    railWidth: s.railWidth,
    listWidth: s.listWidth,
    toolPanelWidth: s.toolPanelWidth,
    terminalHeight: s.terminalHeight,
    toolLayoutMode: s.toolLayoutMode,
    openTools: s.openTools,
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    useLayoutStore.getState().persist()
  }, 200)
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  railWidth: 240,
  listWidth: 280,
  toolPanelWidth: 300,
  terminalHeight: 220,
  toolLayoutMode: 'single',
  openTools: ['cmd'],
  hydrated: false,
  setRailWidth: (n) => {
    set({ railWidth: clamp(n, 180, 420) })
    schedulePersist()
  },
  setListWidth: (n) => {
    set({ listWidth: clamp(n, 200, 480) })
    schedulePersist()
  },
  setToolPanelWidth: (n) => {
    set({ toolPanelWidth: clamp(n, 220, 560) })
    schedulePersist()
  },
  setTerminalHeight: (n) => {
    set({ terminalHeight: clamp(n, 120, 520) })
    schedulePersist()
  },
  setToolLayoutMode: (mode) => {
    set((s) => ({
      toolLayoutMode: mode,
      openTools:
        mode === 'single'
          ? s.openTools.slice(0, 1)
          : TOOL_ORDER.filter((id) => s.openTools.includes(id)),
    }))
    schedulePersist()
  },
  toggleSideTool: (tool) => {
    set((s) => {
      const open = s.openTools.includes(tool)
      if (s.toolLayoutMode === 'single') {
        return { openTools: open ? [] : [tool] }
      }
      if (open) {
        return { openTools: s.openTools.filter((id) => id !== tool) }
      }
      return {
        openTools: TOOL_ORDER.filter(
          (id) => id === tool || s.openTools.includes(id),
        ),
      }
    })
    schedulePersist()
  },
  closeSideTool: (tool) => {
    set((s) => ({ openTools: s.openTools.filter((id) => id !== tool) }))
    schedulePersist()
  },
  hydrate: async () => {
    try {
      const remote = await invoke<LayoutPersist | null>('load_layout')
      if (remote) {
        const mode = parseMode(remote.toolLayoutMode)
        set({
          railWidth: num(remote.railWidth, 240),
          listWidth: num(remote.listWidth, 280),
          toolPanelWidth: num(remote.toolPanelWidth, 300),
          terminalHeight: num(remote.terminalHeight, 220),
          toolLayoutMode: mode,
          openTools: parseOpenTools(remote.openTools, mode),
          hydrated: true,
        })
        return
      }
      const legacy = fromLocalStorage()
      if (legacy) {
        set({ ...legacy, hydrated: true })
        get().persist()
        try {
          localStorage.removeItem('fpm.layout.v4')
          localStorage.removeItem('fpm.layout.v3')
        } catch {
          /* ignore */
        }
        return
      }
    } catch {
      /* fall through to defaults */
    }
    set({ hydrated: true })
  },
  persist: () => {
    const s = get()
    void invoke('save_layout', { layout: snapshot(s) }).catch(() => {})
  },
}))
