import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './tauri'

export type TextFileResult = {
  path: string
  content: string
  size: number
}

/**
 * Read a UTF-8 text file. `root` is the allowed project/workspace root the
 * file must live inside (enforced by the Rust `ensure_within` gate, C1/C2/H1).
 */
export async function readTextFile(
  path: string,
  root: string,
): Promise<TextFileResult> {
  if (!isTauri()) {
    throw new Error('File editing requires the desktop app')
  }
  return invoke<TextFileResult>('read_text_file', { root, path })
}

/** Write a UTF-8 text file; the target must live inside `root`. */
export async function writeTextFile(
  path: string,
  content: string,
  root: string,
): Promise<void> {
  if (!isTauri()) {
    throw new Error('File editing requires the desktop app')
  }
  await invoke('write_text_file', { root, path, content })
}
