import { create } from 'zustand'

const STORAGE_KEY = 'fpm.layout.v4'

export type SideTool = 'ide' | 'cmd' | 'git' | 'env' | 'meta'
export type ToolLayoutMode = 'single' | 'stack'

export const TOOL_ORDER: SideTool[] = ['ide', 'cmd', 'git', 'env', 'meta']

type LayoutState = {
  railWidth: number
  listWidth: number
  /** Expanded tool panel column width in px */
  toolPanelWidth: number
  terminalHeight: number
  /** single = accordion (one panel); stack = multiple panels stacked */
  toolLayoutMode: ToolLayoutMode
  /** Open tool panels (order follows TOOL_ORDER when rendering) */
  openTools: SideTool[]
  setRailWidth: (n: number) => void
  setListWidth: (n: number) => void
  setToolPanelWidth: (n: number) => void
  setTerminalHeight: (n: number) => void
  setToolLayoutMode: (mode: ToolLayoutMode) => void
  toggleSideTool: (tool: SideTool) => void
  closeSideTool: (tool: SideTool) => void
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

function load(): Partial<LayoutState> {
  try {
    const rawV4 = localStorage.getItem(STORAGE_KEY)
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

    // Migrate v3
    const rawV3 = localStorage.getItem('fpm.layout.v3')
    if (rawV3) {
      const o = JSON.parse(rawV3) as {
        railWidth?: number
        listWidth?: number
        toolPanelWidth?: number
        terminalHeight?: number
        sideTool?: unknown
      }
      const side = isSideTool(o.sideTool) ? o.sideTool : o.sideTool === null ? null : 'cmd'
      return {
        railWidth: num(o.railWidth, 240),
        listWidth: num(o.listWidth, 280),
        toolPanelWidth: num(o.toolPanelWidth, 300),
        terminalHeight: num(o.terminalHeight, 220),
        toolLayoutMode: 'single',
        openTools: side ? [side] : [],
      }
    }
    return {}
  } catch {
    return {}
  }
}

const saved = load()

export const useLayoutStore = create<LayoutState>((set, get) => ({
  railWidth: num(saved.railWidth, 240),
  listWidth: num(saved.listWidth, 280),
  toolPanelWidth: num(saved.toolPanelWidth, 300),
  terminalHeight: num(saved.terminalHeight, 220),
  toolLayoutMode: saved.toolLayoutMode ?? 'single',
  openTools: saved.openTools ?? ['cmd'],
  setRailWidth: (n) => set({ railWidth: clamp(n, 180, 420) }),
  setListWidth: (n) => set({ listWidth: clamp(n, 200, 480) }),
  setToolPanelWidth: (n) => set({ toolPanelWidth: clamp(n, 220, 560) }),
  setTerminalHeight: (n) => set({ terminalHeight: clamp(n, 120, 520) }),
  setToolLayoutMode: (mode) =>
    set((s) => ({
      toolLayoutMode: mode,
      openTools:
        mode === 'single'
          ? s.openTools.slice(0, 1)
          : TOOL_ORDER.filter((id) => s.openTools.includes(id)),
    })),
  toggleSideTool: (tool) =>
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
    }),
  closeSideTool: (tool) =>
    set((s) => ({ openTools: s.openTools.filter((id) => id !== tool) })),
  persist: () => {
    const {
      railWidth,
      listWidth,
      toolPanelWidth,
      terminalHeight,
      toolLayoutMode,
      openTools,
    } = get()
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        railWidth,
        listWidth,
        toolPanelWidth,
        terminalHeight,
        toolLayoutMode,
        openTools,
      }),
    )
  },
}))
