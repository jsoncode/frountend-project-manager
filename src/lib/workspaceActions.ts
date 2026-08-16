import { invoke } from '@tauri-apps/api/core'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

function joinPath(parent: string, name: string) {
  const sep = parent.includes('\\') ? '\\' : '/'
  return `${parent.replace(/[/\\]+$/, '')}${sep}${name}`
}

/** Add an existing folder as a workspace. */
export async function addExistingWorkspace(): Promise<string | null> {
  const path = await invoke<string | null>('pick_directory')
  if (!path) return null
  const config = useSettingsStore.getState().config
  if (!config) return null
  const { setActiveWorkspace } = useWorkspaceStore.getState()
  if (config.workspaces.includes(path)) {
    setActiveWorkspace(path)
    return path
  }
  await useSettingsStore.getState().saveWorkspaces([...config.workspaces, path])
  setActiveWorkspace(path)
  return path
}

/**
 * Create a new folder under a chosen parent and add it as a workspace.
 * Returns null if the user cancels parent picking.
 * Throws if create fails.
 */
export async function createNewWorkspace(name: string): Promise<string | null> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('empty name')
  if (/[<>:"|?*\\/]/.test(trimmed)) {
    throw new Error('invalid name')
  }

  const parent = await invoke<string | null>('pick_directory')
  if (!parent) return null

  const full = joinPath(parent, trimmed)
  const created = await invoke<string>('create_directory', { root: parent, path: full })

  const config = useSettingsStore.getState().config
  if (!config) return created

  const { setActiveWorkspace } = useWorkspaceStore.getState()
  if (!config.workspaces.includes(created)) {
    await useSettingsStore
      .getState()
      .saveWorkspaces([...config.workspaces, created])
  }
  setActiveWorkspace(created)
  return created
}
