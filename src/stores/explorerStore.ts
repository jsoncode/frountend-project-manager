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
  /** Project paths with a commit / commit-and-push running (row spinner). */
  committingPaths: Set<string>
  setSelection: (sel: ExplorerSelection) => void
  setExpanded: (updater: string[] | ((prev: string[]) => string[])) => void
  toggleExpanded: (id: string) => void
  /** Mark a project's commit operation as busy (or done). */
  setCommitting: (path: string, busy: boolean) => void
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  selection: null,
  expanded: [],
  committingPaths: new Set<string>(),
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
  setCommitting: (path, busy) => {
    set((s) => {
      const next = new Set(s.committingPaths)
      if (busy) next.add(path)
      else next.delete(path)
      return { committingPaths: next }
    })
  },
}))
