import { create } from '../lib/createStore'

type EditorUiState = {
  /** Absolute path of the open file that has unsaved edits, else null. */
  dirtyPath: string | null
  setDirtyPath: (path: string | null) => void
}

export const useEditorStore = create<EditorUiState>((set) => ({
  dirtyPath: null,
  setDirtyPath: (dirtyPath) => set({ dirtyPath }),
}))
