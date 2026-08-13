import { create } from '../lib/createStore'

export type ExplorerSelection =
  | { kind: 'workspace'; path: string }
  | { kind: 'project'; path: string; workspace: string }
  | { kind: 'dir'; path: string; projectPath: string }
  | { kind: 'file'; path: string; projectPath: string }
  | null

/**
 * Live DOM refs of explorer rows (keyed by `proj:<path>` / `ws:<path>`),
 * registered by Explorer — lets other components (e.g. TerminalPanel)
 * scroll a project row into view without a shared component ref.
 */
export const explorerRowEls = new Map<string, HTMLButtonElement>()

type ExplorerState = {
  selection: ExplorerSelection
  expanded: string[]
  setSelection: (sel: ExplorerSelection) => void
  setExpanded: (updater: string[] | ((prev: string[]) => string[])) => void
  toggleExpanded: (id: string) => void
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  selection: null,
  expanded: [],
  setSelection: (selection) => set({ selection }),
  setExpanded: (updater) => {
    const next = typeof updater === 'function' ? updater(get().expanded) : updater
    set({ expanded: next })
  },
  toggleExpanded: (id) => {
    const prev = get().expanded
    const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    set({ expanded: next })
  },
}))
