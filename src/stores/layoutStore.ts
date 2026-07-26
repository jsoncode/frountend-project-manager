import { invoke } from '@tauri-apps/api/core'
import { create } from '../lib/createStore'

export type SideTool = 'git' | 'ide' | 'cmd' | 'env' | 'meta'
export type ToolLayoutMode = 'single' | 'stack'

export const TOOL_ORDER: SideTool[] = ['git', 'ide', 'cmd', 'env', 'meta']

type LayoutPersist = {
  explorerWidth: number
  toolPanelWidth: number
  terminalHeight: number
  toolLayoutMode: ToolLayoutMode
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
  return (
    v === 'git' ||
    v === 'ide' ||
    v === 'cmd' ||
    v === 'env' ||
    v === 'meta'
  )
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
      const mode = parseMode(o.toolLayoutMode)
      return {
        explorerWidth: resolveExplorerWidth(o),
        toolPanelWidth: num(o.toolPanelWidth, 300),
        terminalHeight: num(o.terminalHeight, 220),
        toolLayoutMode: mode,
        openTools: parseOpenTools(o.openTools, mode),
      }
    }
    const rawV3 = localStorage.getItem('fpm.layout.v3')
    if (rawV3) {
      const o = JSON.parse(rawV3) as LayoutRemote & { sideTool?: unknown }
      const side = isSideTool(o.sideTool)
        ? o.sideTool
        : o.sideTool === null
          ? null
          : 'cmd'
      return {
        explorerWidth: resolveExplorerWidth(o),
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
    explorerWidth: s.explorerWidth,
    // Keep legacy keys so older builds still load something sensible.
    railWidth: 0,
    listWidth: s.explorerWidth,
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

function applyRemote(remote: LayoutRemote): LayoutPersist {
  const mode = parseMode(remote.toolLayoutMode)
  return {
    explorerWidth: resolveExplorerWidth(remote),
    toolPanelWidth: num(remote.toolPanelWidth, 300),
    terminalHeight: num(remote.terminalHeight, 220),
    toolLayoutMode: mode,
    openTools: parseOpenTools(remote.openTools, mode),
  }
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  explorerWidth: 280,
  toolPanelWidth: 300,
  terminalHeight: 220,
  toolLayoutMode: 'single',
  openTools: ['cmd'],
  hydrated: false,
  setExplorerWidth: (n) => {
    set({ explorerWidth: clamp(n, 200, 560) })
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
      return { openTools: open ? [] : [tool], toolLayoutMode: 'single' }
    })
    schedulePersist()
  },
  closeSideTool: (tool) => {
    set((s) => ({
      openTools: s.openTools.filter((id) => id !== tool),
      toolLayoutMode: 'single',
    }))
    schedulePersist()
  },
  hydrate: async () => {
    try {
      const remote = await invoke<LayoutRemote | null>('load_layout')
      if (remote) {
        const applied = applyRemote(remote)
        set({
          ...applied,
          toolLayoutMode: 'single',
          openTools: applied.openTools.slice(0, 1),
          hydrated: true,
        })
        return
      }
      const legacy = fromLocalStorage()
      if (legacy) {
        set({
          ...legacy,
          toolLayoutMode: 'single',
          openTools: legacy.openTools.slice(0, 1),
          hydrated: true,
        })
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
