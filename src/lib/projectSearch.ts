import { match as pinyinMatch } from 'pinyin-pro'
import type { ProjectSummary } from './types'

/** Show README title in the list only when it is short enough. */
export const DISPLAY_NAME_MAX_CHARS = 12

export function shortDisplayName(name: string | null | undefined): string | null {
  if (!name) return null
  const t = name.trim()
  if (!t) return null
  if ([...t].length > DISPLAY_NAME_MAX_CHARS) return null
  return t
}

/** Subtitle under folder name: short README title → package.json name. */
export function projectSubtitle(p: ProjectSummary): string {
  return shortDisplayName(p.displayName) ?? p.pkgName?.trim() ?? '—'
}

function fieldMatches(text: string, q: string): boolean {
  const t = text.trim()
  if (!t || !q) return false
  if (t.toLowerCase().includes(q.toLowerCase())) return true
  // Pinyin / initials / fuzzy (pinyin-pro)
  try {
    return pinyinMatch(t, q) !== null
  } catch {
    return false
  }
}

/** Match folder name, README title, and package name (substring + pinyin). */
export function projectMatchesQuery(p: ProjectSummary, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  const fields = [p.folderName, p.displayName ?? '', p.pkgName ?? '']
  return fields.some((f) => fieldMatches(f, q))
}
