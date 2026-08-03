import type { GitStatusEntry } from './types'

/** VS Code–style short marks for the explorer. */
export type GitFileMark = 'M' | 'U' | 'A' | 'D' | 'R' | 'C'

export type GitDecorationIndex = {
  /** project-relative path (lowercase, `/`) → mark */
  files: Record<string, GitFileMark>
  /** project-relative dir paths → count of changed files within (incl. `''` for project root) */
  dirs: Record<string, number>
}

export function normalizeFsPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** Strip git porcelain quoting: `"foo\\ bar"` → `foo bar` */
export function unquoteGitPath(raw: string): string {
  let p = raw.trim()
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) {
    p = p.slice(1, -1).replace(/\\([\\"ntr])/g, (_, c: string) => {
      if (c === 'n') return '\n'
      if (c === 't') return '\t'
      if (c === 'r') return '\r'
      return c
    })
  }
  return p.replace(/\\/g, '/')
}

export function markFromGitCode(code: string): GitFileMark | null {
  const xy = code.length >= 2 ? code.slice(0, 2) : code
  if (xy === '!!') return null
  if (xy === '??') return 'U'
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return null
  if (xy.includes('R')) return 'R'
  if (xy.includes('C')) return 'C'
  if (xy.includes('A')) return 'A'
  if (xy.includes('D')) return 'D'
  return 'M'
}

/** Absolute path → project-relative key, or null if outside the project. */
export function toProjectRelative(
  absPath: string,
  projectRoot: string,
): string | null {
  const a = normalizeFsPath(absPath)
  const r = normalizeFsPath(projectRoot)
  if (a === r) return ''
  if (a.startsWith(`${r}/`)) return a.slice(r.length + 1)
  return null
}

export function buildGitDecorationIndex(
  _projectRoot: string,
  entries: GitStatusEntry[],
): GitDecorationIndex {
  const files: Record<string, GitFileMark> = {}
  const dirs: Record<string, number> = {}

  for (const e of entries) {
    if (!e.path) continue
    const mark = markFromGitCode(e.code)
    if (!mark) continue

    const rel = unquoteGitPath(e.path).replace(/^\/+/, '').toLowerCase()
    if (!rel) continue

    const prev = files[rel]
    if (!prev || markPriority(mark) >= markPriority(prev)) {
      files[rel] = mark
    }

    // Parent segments: test/a.html → test, and '' (project root)
    const parts = rel.split('/')
    dirs[''] = (dirs[''] ?? 0) + 1
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts.slice(0, i + 1).join('/')
      dirs[key] = (dirs[key] ?? 0) + 1
    }
  }

  return { files, dirs }
}

function markPriority(m: GitFileMark): number {
  switch (m) {
    case 'U':
      return 4
    case 'M':
      return 3
    case 'A':
    case 'D':
    case 'R':
      return 2
    case 'C':
      return 1
    default:
      return 0
  }
}

export const EMPTY_GIT_DECORATIONS: GitDecorationIndex = {
  files: {},
  dirs: {},
}
