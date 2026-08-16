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

export type EditorThemeId =
  | 'vs-dark'
  | 'vs'
  | 'fpm-dark'
  | 'fpm-midnight'
  | 'fpm-dracula'
  | 'hc-black'

export type AppConfig = {
  workspaces: string[]
  tags: Record<string, string[]>
  ides: IdeConfig[]
  commandHistory?: Record<string, HistoryItem[]>
  branchHistory?: Record<string, HistoryItem[]>
  /** Favorite branch names per project (independent from history) */
  branchFavorites?: Record<string, string[]>
  searchHistory?: HistoryItem[]
  /** project path → last accessed ms */
  projectAccess?: Record<string, number>
  /** project path → chosen package manager ("npm" | "pnpm" | "yarn") */
  projectPms?: Record<string, string>
  /** UI language: zh | en — default zh */
  locale?: 'zh' | 'en'
  /** Monaco editor color theme id — default 'vs-dark' */
  editorTheme?: EditorThemeId
}

export type ProjectSummary = {
  folderName: string
  path: string
  pkgName?: string | null
  /** First line of README.md (heading markers stripped). */
  displayName?: string | null
  frameworks: string[]
  scripts: Record<string, string>
}

export type ProjectDetails = {
  summary: ProjectSummary
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
  /** Remote URLs (`git remote -v`); empty/missing when no remote is set. */
  remotes?: string[]
}

export type GitStatusEntry = {
  code: string
  path: string
  label: string
}

export type GitLogEntry = {
  /** Full 40-char commit hash. */
  hash: string
  /** Abbreviated commit hash (git's default 7+ chars). */
  shortHash: string
  authorName: string
  authorEmail: string
  /** Author date, strict ISO 8601. */
  authorDate: string
  /** Committer date, strict ISO 8601. */
  committerDate: string
  /** First line of the commit message. */
  subject: string
  /** Rest of the commit message (empty when single-line). */
  body: string
  /** Ref decorations, e.g. "HEAD -> main, origin/main, tag: v1.0". */
  refs: string
  /** Parent hashes, space-separated (empty for the root commit). */
  parents: string
}

export type GitStatus = {
  clean: boolean
  current?: string | null
  entries: GitStatusEntry[]
}

export type MergeFileEntry = {
  path: string
  code: string
  conflict: boolean
  label: string
}

export type MergeStatus = {
  inProgress: boolean
  current?: string | null
  incoming?: string | null
  files: MergeFileEntry[]
  conflictCount: number
}

export type MergeStartResult = {
  status: 'clean' | 'conflicts' | string
  message: string
  merge: MergeStatus
}

export type MergeFileSides = {
  /** Common ancestor (stage 1) for per-side change highlighting. */
  base: string
  ours: string
  theirs: string
  working: string
}

export type PullBranchItem = {
  name: string
  /** "updated" | "uptodate" | "conflicts" | "error" */
  status: string
  message: string
}

export type PullBranchResult = {
  /** "updated" | "uptodate" | "conflicts" | "error" */
  status: 'updated' | 'uptodate' | 'conflicts' | 'error' | string
  message: string
  merge?: MergeStatus | null
  /** Per-branch outcomes (git_pull_all / git_pull_branch). */
  branches?: PullBranchItem[]
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
  /** User or app has run at least one command in this tab. */
  dirty: boolean
  /** Shell exited (pty://exit) — never reuse this tab for commands (audit P1-11). */
  dead?: boolean
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
