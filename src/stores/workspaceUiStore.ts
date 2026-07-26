import { create } from '../lib/createStore'

type WorkspaceUiState = {
  newWorkspaceOpen: boolean
  openNewWorkspace: () => void
  closeNewWorkspace: () => void
}

export const useWorkspaceUiStore = create<WorkspaceUiState>((set) => ({
  newWorkspaceOpen: false,
  openNewWorkspace: () => set({ newWorkspaceOpen: true }),
  closeNewWorkspace: () => set({ newWorkspaceOpen: false }),
}))
