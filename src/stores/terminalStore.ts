import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { create } from '../lib/createStore'
import { isTauri } from '../lib/tauri'
import type { TermSession } from '../lib/types'
import { getTerminalPlainText, markPtyReady, waitPtyReady, writeHostToTerminal, writeToTerminal } from '../lib/ptyHost'
import {
  detectIssueKind,
  stripAnsi,
  trimLogTail,
  type TermIssueAlert,
  type TermIssueKind,
} from '../lib/termIssue'
import { useSettingsStore } from './settingsStore'
import { useProjectStore } from './projectStore'

let seq = 1

function newId() {
  return `term-${Date.now()}-${seq++}`
}

function normalizeProjectPath(path: string) {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function isSameProject(a: string, b: string) {
  return normalizeProjectPath(a) === normalizeProjectPath(b)
}

/** Heuristic: chunk looks like a shell returned to an idle prompt. */
function looksLikeShellPrompt(chunk: string): boolean {
  // Strip ANSI escape codes first — colored prompts (e.g. oh-my-posh)
  // would otherwise break the regex match, leaving `running` stuck true.
  const text = stripAnsi(chunk)
  // PowerShell: PS C:\path>   |  cmd: C:\path>  |  bash-ish: ...$ or ...#
  return /(?:^|[\r\n])(?:PS\s+\S.*>\s?|[A-Za-z]:[^>\r\n]*>\s?|[^>\r\n]*[$#]\s?)\s*$/.test(
    text,
  )
}

type PtyDataEvent = { terminalId: string; data: string }
type PtyExitEvent = { terminalId: string; code?: number | null }

type EnsureOpts = {
  /** When true, reuse the current same-project tab even if a command is running (for echo logs). */
  allowBusy?: boolean
}

/** Debounced buffer snapshot after an issue keyword appears. */
const issueCaptureTimers = new Map<string, number>()
const pendingIssueKind = new Map<string, TermIssueKind>()

/** Track the last command sent to each session for git-refresh detection. */
const lastCommandMap = new Map<string, string>()

/** Check if a command string contains git operations. */
function isGitCommand(cmd: string): boolean {
  const trimmed = cmd.trim()
  return /\bgit\s+(push|pull|fetch|commit|merge|rebase|checkout|switch|add|reset|stash|am|cherry-pick|branch)\b/i.test(trimmed)
}

function scheduleIssueCapture(
  terminalId: string,
  kind: TermIssueKind,
  setAlert: (id: string, alert: TermIssueAlert) => void,
) {
  const prev = pendingIssueKind.get(terminalId)
  // Prefer error over warning if both fire in the same burst.
  if (!(prev === 'error' && kind === 'warning')) {
    pendingIssueKind.set(terminalId, kind)
  }
  const existing = issueCaptureTimers.get(terminalId)
  if (existing) window.clearTimeout(existing)
  const timer = window.setTimeout(() => {
    issueCaptureTimers.delete(terminalId)
    const finalKind = pendingIssueKind.get(terminalId) ?? kind
    pendingIssueKind.delete(terminalId)
    const raw = getTerminalPlainText(terminalId, 120)
    const snippet = trimLogTail(raw)
    if (!snippet.trim()) return
    setAlert(terminalId, {
      kind: finalKind,
      snippet,
      detectedAt: Date.now(),
    })
  }, 450)
  issueCaptureTimers.set(terminalId, timer)
}

type TerminalState = {
  sessions: TermSession[]
  activeId: string | null
  /** Per-session auto-detected log issues for the AI analyze FAB. */
  issueAlerts: Record<string, TermIssueAlert | undefined>
  createSession: (projectPath: string, projectName: string) => string
  closeSession: (id: string) => Promise<void>
  setActive: (id: string) => void
  /**
   * Prefer idle connected active tab for the project.
   * If busy, create a new tab (unless allowBusy).
   * Reuse a still-booting tab instead of spawning duplicates.
   */
  ensureRunTarget: (
    projectPath: string,
    projectName: string,
    opts?: EnsureOpts,
  ) => string
  runInSession: (terminalId: string, projectPath: string, command: string) => Promise<void>
  runScript: (projectPath: string, projectName: string, pm: string, script: string) => Promise<void>
  runRaw: (projectPath: string, projectName: string, command: string) => Promise<string>
  /** Resolve when the session is no longer marked running (shell back at prompt). */
  waitUntilIdle: (terminalId: string, timeoutMs?: number) => Promise<void>
  markConnected: (id: string, connected: boolean) => void
  markRunning: (id: string, running: boolean) => void
  markDirty: (id: string) => void
  setIssueAlert: (id: string, alert: TermIssueAlert) => void
  clearIssueAlert: (id: string) => void
  startListening: () => Promise<UnlistenFn>
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  activeId: null,
  issueAlerts: {},

  createSession: (projectPath, projectName) => {
    const id = newId()
    const session: TermSession = {
      id,
      title: projectName,
      projectPath,
      projectName,
      connected: false,
      running: false,
      dirty: false,
    }
    set((s) => ({
      sessions: [...s.sessions, session],
      activeId: id,
    }))
    return id
  },

  closeSession: async (id) => {
    const t = issueCaptureTimers.get(id)
    if (t) window.clearTimeout(t)
    issueCaptureTimers.delete(id)
    pendingIssueKind.delete(id)
    try {
      if (isTauri()) {
        await invoke('pty_kill', { terminalId: id })
      }
    } catch {
      /* already dead */
    }
    set((s) => {
      const sessions = s.sessions.filter((t) => t.id !== id)
      const activeId =
        s.activeId === id ? (sessions[sessions.length - 1]?.id ?? null) : s.activeId
      const issueAlerts = { ...s.issueAlerts }
      delete issueAlerts[id]
      return { sessions, activeId, issueAlerts }
    })
  },

  setActive: (id) => set({ activeId: id }),

  markConnected: (id, connected) =>
    set((s) => ({
      sessions: s.sessions.map((t) =>
        t.id === id
          ? { ...t, connected, running: connected ? t.running : false }
          : t,
      ),
    })),

  markRunning: (id, running) =>
    set((s) => {
      // New command → clear previous analyze chip for this tab.
      if (running) {
        const issueAlerts = { ...s.issueAlerts }
        delete issueAlerts[id]
        return {
          sessions: s.sessions.map((t) =>
            t.id === id ? { ...t, running, dirty: true } : t,
          ),
          issueAlerts,
        }
      }
      return {
        sessions: s.sessions.map((t) => (t.id === id ? { ...t, running } : t)),
      }
    }),

  markDirty: (id) =>
    set((s) => ({
      sessions: s.sessions.map((t) =>
        t.id === id && !t.dirty ? { ...t, dirty: true } : t,
      ),
    })),

  setIssueAlert: (id, alert) =>
    set((s) => ({
      issueAlerts: { ...s.issueAlerts, [id]: alert },
    })),

  clearIssueAlert: (id) =>
    set((s) => {
      const issueAlerts = { ...s.issueAlerts }
      delete issueAlerts[id]
      return { issueAlerts }
    }),

  ensureRunTarget: (projectPath, projectName, opts) => {
    const allowBusy = opts?.allowBusy === true
    const { sessions, activeId, createSession } = get()
    const active = sessions.find((s) => s.id === activeId)
    const same = (s: TermSession) => isSameProject(s.projectPath, projectPath)
    // A session whose shell exited (dead) must never be treated as "still
    // booting" — commands routed there would be silently swallowed by the
    // backend (audit P1-11).
    const usable = (s: TermSession) => !s.dead

    // 1) Current tab, same project, idle (or allowBusy) → reuse
    if (active && same(active) && usable(active)) {
      if (!active.connected) {
        // Still booting — never spawn a duplicate for the same click burst
        return active.id
      }
      if (!active.running || allowBusy) {
        return active.id
      }
    }

    // 2) Any other same-project idle connected tab
    const idle = sessions.find((s) => same(s) && usable(s) && s.connected && !s.running)
    if (idle) {
      set({ activeId: idle.id })
      return idle.id
    }

    // 3) Same-project tab still connecting
    const pending = sessions.find((s) => same(s) && usable(s) && !s.connected)
    if (pending) {
      set({ activeId: pending.id })
      return pending.id
    }

    // 4) Busy (or none, or only dead tabs) → new tab; drop stale dead tabs
    //    for this project so they don't pile up in the tab strip.
    const deadTabs = sessions.filter((s) => same(s) && s.dead)
    if (deadTabs.length > 0) {
      for (const t of deadTabs) {
        void get().closeSession(t.id)
      }
    }
    return createSession(projectPath, projectName)
  },

  runInSession: async (terminalId, _projectPath, command) => {
    const cmd = command.trim()
    if (!cmd) return
    try {
      await waitPtyReady(terminalId)
      get().markRunning(terminalId, true)
      // Track last command for git-refresh detection
      lastCommandMap.set(terminalId, cmd)
      // PowerShell / cmd both accept \r as Enter in ConPTY
      await invoke('pty_write', { terminalId, data: `${cmd}\r` })
    } catch (e) {
      get().markRunning(terminalId, false)
      writeHostToTerminal(terminalId, `\r\n\x1b[31mError: ${String(e)}\x1b[0m\r\n`)
    }
  },

  runScript: async (projectPath, projectName, pm, script) => {
    // npm 必须 `run`；pnpm / yarn / bun 可省略
    const command = pm === 'npm' ? `npm run ${script}` : `${pm} ${script}`
    void useSettingsStore.getState().touchCommandHistory(projectPath, script)
    await get().runRaw(projectPath, projectName, command)
  },

  runRaw: async (projectPath, projectName, command) => {
    const id = get().ensureRunTarget(projectPath, projectName)
    await get().runInSession(id, projectPath, command)
    return id
  },

  waitUntilIdle: async (terminalId, timeoutMs = 180_000) => {
    const started = Date.now()
    // Allow markRunning(true) from runInSession to land first.
    await new Promise<void>((r) => window.setTimeout(r, 40))
    while (Date.now() - started < timeoutMs) {
      const session = get().sessions.find((s) => s.id === terminalId)
      if (!session) return
      // Idle = no foreground command. A disconnected/dead session can never
      // satisfy `connected && !running` — treat it as idle so callers don't
      // spin the full timeout (audit P2-12).
      if (!session.running) return
      await new Promise<void>((r) => window.setTimeout(r, 80))
    }
  },

  startListening: async () => {
    if (!isTauri()) {
      return () => undefined
    }
    const unData = await listen<PtyDataEvent>('pty://data', (event) => {
      const id = event.payload.terminalId
      const data = event.payload.data
      writeToTerminal(id, data)
      // First interactive prompt → allow shortcut / runRaw to write commands.
      if (looksLikeShellPrompt(data)) {
        markPtyReady(id)
      }
      const session = get().sessions.find((t) => t.id === id)
      if (session?.running && looksLikeShellPrompt(data)) {
        get().markRunning(id, false)
        // After any command finishes, refresh git file status (lightweight).
        // If it was a git command, also refresh branch info (triggers fetch).
        const store = useProjectStore.getState()
        if (store.selected) {
          setTimeout(() => {
            void store.refreshGitStatus()
          }, 300)
          const lastCmd = lastCommandMap.get(id)
          if (lastCmd) {
            lastCommandMap.delete(id)
            if (isGitCommand(lastCmd)) {
              setTimeout(() => {
                void store.refreshGit()
                // Also check for merge conflicts (e.g. after git pull)
                void store.refreshMergeStatus()
              }, 300)
            }
          }
        }
      }
      const kind = detectIssueKind(data)
      if (kind) {
        scheduleIssueCapture(id, kind, (tid, alert) =>
          get().setIssueAlert(tid, alert),
        )
      }
    })
    const unExit = await listen<PtyExitEvent>('pty://exit', (event) => {
      const id = event.payload.terminalId
      // Shell exited: mark the tab dead so ensureRunTarget never reuses it
      // (audit P1-11). A `code: null` event from pty_kill is handled the same
      // way — closeSession's pty_kill makes the second exit event a no-op.
      get().markConnected(id, false)
      set((s) => ({
        sessions: s.sessions.map((t) =>
          t.id === id ? { ...t, dead: true } : t,
        ),
      }))
      const code = event.payload.code
      const msg =
        code == null
          ? '\r\n\x1b[90m[shell closed]\x1b[0m\r\n'
          : `\r\n\x1b[90m[shell exit ${code}]\x1b[0m\r\n`
      writeHostToTerminal(id, msg)
    })
    return () => {
      unData()
      unExit()
      for (const t of issueCaptureTimers.values()) window.clearTimeout(t)
      issueCaptureTimers.clear()
      pendingIssueKind.clear()
    }
  },
}))
