export type IdeConfig = {
  id: string
  name: string
  executable: string
  argsTemplate: string
  enabled: boolean
  builtin?: boolean
  /** Absolute path to icon image */
  iconPath?: string | null
}

export type InstalledEditor = {
  name: string
  executable: string
  available: boolean
}

export type HistoryItem = {
  value: string
  count: number
  lastUsedAt: number
  pinned: boolean
}

export type AppConfig = {
  workspaces: string[]
  tags: Record<string, string[]>
  ides: IdeConfig[]
  commandHistory?: Record<string, HistoryItem[]>
  branchHistory?: Record<string, HistoryItem[]>
  searchHistory?: HistoryItem[]
  /** project path → last accessed ms */
  projectAccess?: Record<string, number>
  /** UI language: zh | en — default zh */
  locale?: 'zh' | 'en'
}

export type ProjectSummary = {
  folderName: string
  path: string
  pkgName?: string | null
  pkgVersion?: string | null
  /** First line of README.md (heading markers stripped). */
  displayName?: string | null
  frameworks: string[]
  scripts: Record<string, string>
}

export type ProjectDetails = {
  summary: ProjectSummary
  languages: string[]
  packageManager: string
}

export type BranchItem = {
  name: string
  isRemote: boolean
  ahead: number
  behind: number
}

export type GitInfo = {
  current?: string | null
  branches: BranchItem[]
}

export type GitStatusEntry = {
  code: string
  path: string
  label: string
}

export type GitStatus = {
  clean: boolean
  current?: string | null
  entries: GitStatusEntry[]
}

export type EnvFileInfo = {
  name: string
  path: string
}

export type EnvEntry = {
  key: string
  value: string
}

export type TerminalLine = {
  terminalId: string
  projectPath: string
  stream: 'stdout' | 'stderr' | 'system' | 'stdin'
  line: string
}

export type TermSession = {
  id: string
  title: string
  projectPath: string
  projectName: string
  /** PTY shell is alive */
  connected: boolean
  /** A foreground command is in progress (app-dispatched). */
  running: boolean
}

export function sortScriptNames(names: string[]): string[] {
  const priority = [
    'dev',
    'start',
    'serve',
    'build',
    'preview',
    'test',
    'lint',
    'typecheck',
    'format',
  ]
  const rank = (name: string) => {
    const lower = name.toLowerCase()
    const idx = priority.findIndex(
      (p) => lower === p || lower.startsWith(`${p}:`) || lower.startsWith(`${p}-`),
    )
    return idx === -1 ? 1000 : idx
  }
  return [...names].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    return a.localeCompare(b)
  })
}
