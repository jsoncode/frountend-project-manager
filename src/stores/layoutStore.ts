import { create } from 'zustand'

const STORAGE_KEY = 'fpm.layout.v3'

export type SideTool = 'cmd' | 'git' | 'env' | 'meta' | 'ide'

type LayoutState = {
  railWidth: number
  listWidth: number
  /** Expanded tool panel width in px */
  toolPanelWidth: number
  terminalHeight: number
  /** Active right tool window; null = collapsed (strip only) */
  sideTool: SideTool | null
  setRailWidth: (n: number) => void
  setListWidth: (n: number) => void
  setToolPanelWidth: (n: number) => void
  setTerminalHeight: (n: number) => void
  setSideTool: (tool: SideTool | null) => void
  toggleSideTool: (tool: SideTool) => void
  persist: () => void
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function num(v: unknown, fallback: number) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function parseSideTool(v: unknown): SideTool | null {
  if (v === null) return null
  if (v === 'cmd' || v === 'git' || v === 'env' || v === 'meta' || v === 'ide') return v
  return 'cmd'
}

function load(): Partial<LayoutState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const o = JSON.parse(raw) as Partial<LayoutState>
      return {
        railWidth: num(o.railWidth, 240),
        listWidth: num(o.listWidth, 280),
        toolPanelWidth: num(o.toolPanelWidth, 300),
        terminalHeight: num(o.terminalHeight, 220),
        sideTool: parseSideTool(o.sideTool),
      }
    }
    const old = localStorage.getItem('fpm.layout.v2')
    if (old) {
      const o = JSON.parse(old) as {
        railWidth?: number
        listWidth?: number
        sideWidth?: number
        terminalHeight?: number
      }
      return {
        railWidth: num(o.railWidth, 240),
        listWidth: num(o.listWidth, 280),
        toolPanelWidth: o.sideWidth
          ? Math.round(320 * (num(o.sideWidth, 32) / 32))
          : 300,
        terminalHeight: num(o.terminalHeight, 220),
        sideTool: 'git',
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
  sideTool: parseSideTool(saved.sideTool ?? 'cmd'),
  setRailWidth: (n) => set({ railWidth: clamp(n, 180, 420) }),
  setListWidth: (n) => set({ listWidth: clamp(n, 200, 480) }),
  setToolPanelWidth: (n) => set({ toolPanelWidth: clamp(n, 220, 520) }),
  setTerminalHeight: (n) => set({ terminalHeight: clamp(n, 120, 520) }),
  setSideTool: (tool) => set({ sideTool: tool }),
  toggleSideTool: (tool) =>
    set((s) => ({ sideTool: s.sideTool === tool ? null : tool })),
  persist: () => {
    const { railWidth, listWidth, toolPanelWidth, terminalHeight, sideTool } = get()
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ railWidth, listWidth, toolPanelWidth, terminalHeight, sideTool }),
    )
  },
}))
