import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './tauri'

export type TextFileResult = {
  path: string
  content: string
  size: number
}

export async function readTextFile(path: string): Promise<TextFileResult> {
  if (!isTauri()) {
    throw new Error('File editing requires the desktop app')
  }
  return invoke<TextFileResult>('read_text_file', { path })
}

export async function writeTextFile(
  path: string,
  content: string,
): Promise<void> {
  if (!isTauri()) {
    throw new Error('File editing requires the desktop app')
  }
  await invoke('write_text_file', { path, content })
}
