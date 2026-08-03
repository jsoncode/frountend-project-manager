import { invoke } from '@tauri-apps/api/core'
import { create } from '../lib/createStore'

/** Action bar tabs (「信息」已移除). */
export type SideTool = 'git' | 'ide' | 'cmd' | 'env'

export const TOOL_ORDER: SideTool[] = ['git', 'ide', 'cmd', 'env']

type LayoutPersist = {
  explorerWidth: number
  toolPanelWidth: number
  terminalHeight: number
  /** Always exactly one active action-bar tab. */
  openTools: SideTool[]
}

/** Wire format — includes legacy dual-pane fields for migration. */
type LayoutRemote = {
  explorerWidth?: number
  railWidth?: number
  listWidth?: number
  toolPanelWidth?: number
  terminalHeight?: number
  toolLayoutMode?: unknown
  openTools?: unknown
}

type LayoutState = LayoutPersist & {
  hydrated: boolean
  setExplorerWidth: (n: number) => void
  setToolPanelWidth: (n: number) => void
  setTerminalHeight: (n: number) => void
  setActiveTool: (tool: SideTool) => void
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
  return v === 'git' || v === 'ide' || v === 'cmd' || v === 'env'
}

function normalizeActiveTool(v: unknown): SideTool {
  if (Array.isArray(v)) {
    const first = v.find(isSideTool)
    if (first) return first
  }
  if (isSideTool(v)) return v
  // Legacy: sideTool / meta → fall back to cmd
  return 'cmd'
}

function resolveExplorerWidth(o: LayoutRemote): number {
  const explorer = num(o.explorerWidth, 0)
  if (explorer > 0) return clamp(explorer, 200, 560)
  const list = num(o.listWidth, 0)
  const rail = num(o.railWidth, 0)
  if (list > 0 && rail > 0) return clamp(list + rail * 0.35, 200, 560)
  if (list > 0) return clamp(list, 200, 560)
  if (rail > 0) return clamp(rail, 200, 560)
  return 280
}

function fromLocalStorage(): LayoutPersist | null {
  try {
    const rawV4 = localStorage.getItem('fpm.layout.v4')
    if (rawV4) {
      const o = JSON.parse(rawV4) as LayoutRemote
      return {
        explorerWidth: resolveExplorerWidth(o),
        toolPanelWidth: num(o.toolPanelWidth, 280),
        terminalHeight: num(o.terminalHeight, 220),
        openTools: [normalizeActiveTool(o.openTools)],
      }
    }
    const rawV3 = localStorage.getItem('fpm.layout.v3')
    if (rawV3) {
      const o = JSON.parse(rawV3) as LayoutRemote & { sideTool?: unknown }
      const side = normalizeActiveTool(o.sideTool ?? o.openTools)
      return {
        explorerWidth: resolveExplorerWidth(o),
        toolPanelWidth: num(o.toolPanelWidth, 280),
        terminalHeight: num(o.terminalHeight, 220),
        openTools: [side],
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

function snapshot(s: LayoutPersist) {
  return {
    explorerWidth: s.explorerWidth,
    railWidth: 0,
    listWidth: s.explorerWidth,
    toolPanelWidth: s.toolPanelWidth,
    terminalHeight: s.terminalHeight,
    toolLayoutMode: 'single',
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

function applyRemote(remote: LayoutRemote): LayoutPersist {
  return {
    explorerWidth: resolveExplorerWidth(remote),
    toolPanelWidth: num(remote.toolPanelWidth, 280),
    terminalHeight: num(remote.terminalHeight, 220),
    openTools: [normalizeActiveTool(remote.openTools)],
  }
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  explorerWidth: 280,
  toolPanelWidth: 280,
  terminalHeight: 220,
  openTools: ['cmd'],
  hydrated: false,
  setExplorerWidth: (n) => {
    set({ explorerWidth: clamp(n, 200, 560) })
    schedulePersist()
  },
  setToolPanelWidth: (n) => {
    set({ toolPanelWidth: clamp(n, 200, 480) })
    schedulePersist()
  },
  setTerminalHeight: (n) => {
    set({ terminalHeight: clamp(n, 120, 520) })
    schedulePersist()
  },
  setActiveTool: (tool) => {
    set({ openTools: [tool] })
    schedulePersist()
  },
  hydrate: async () => {
    try {
      const remote = await invoke<LayoutRemote | null>('load_layout')
      if (remote) {
        set({ ...applyRemote(remote), hydrated: true })
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
