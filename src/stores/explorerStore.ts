import { create } from '../lib/createStore'

export type ExplorerSelection =
  | { kind: 'workspace'; path: string }
  | { kind: 'project'; path: string; workspace: string }
  | { kind: 'dir'; path: string; projectPath: string }
  | { kind: 'file'; path: string; projectPath: string }
  | null

type ExplorerState = {
  selection: ExplorerSelection
  setSelection: (sel: ExplorerSelection) => void
}

export const useExplorerStore = create<ExplorerState>((set) => ({
  selection: null,
  setSelection: (selection) => set({ selection }),
}))
