import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { create } from 'zustand'
import { isTauri } from '../lib/tauri'
import type { TermSession } from '../lib/types'
import { waitPtyReady, writeToTerminal } from '../lib/ptyHost'
import { useSettingsStore } from './settingsStore'

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
  // PowerShell: PS C:\path>   |  cmd: C:\path>  |  bash-ish: ...$ or ...#
  return /(?:^|[\r\n])(?:PS\s+\S.*>\s?|[A-Za-z]:[^>\r\n]*>\s?|[^>\r\n]*[$#]\s?)\s*$/.test(
    chunk,
  )
}

type PtyDataEvent = { terminalId: string; data: string }
type PtyExitEvent = { terminalId: string; code?: number | null }

type EnsureOpts = {
  /** When true, reuse the current same-project tab even if a command is running (for echo logs). */
  allowBusy?: boolean
}

type TerminalState = {
  sessions: TermSession[]
  activeId: string | null
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
  runRaw: (projectPath: string, projectName: string, command: string) => Promise<void>
  markConnected: (id: string, connected: boolean) => void
  markRunning: (id: string, running: boolean) => void
  startListening: () => Promise<UnlistenFn>
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  activeId: null,

  createSession: (projectPath, projectName) => {
    const id = newId()
    const count =
      get().sessions.filter((s) => isSameProject(s.projectPath, projectPath))
        .length + 1
    const session: TermSession = {
      id,
      title: `${projectName} #${count}`,
      projectPath,
      projectName,
      connected: false,
      running: false,
    }
    set((s) => ({
      sessions: [...s.sessions, session],
      activeId: id,
    }))
    return id
  },

  closeSession: async (id) => {
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
      return { sessions, activeId }
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
    set((s) => ({
      sessions: s.sessions.map((t) => (t.id === id ? { ...t, running } : t)),
    })),

  ensureRunTarget: (projectPath, projectName, opts) => {
    const allowBusy = opts?.allowBusy === true
    const { sessions, activeId, createSession } = get()
    const active = sessions.find((s) => s.id === activeId)
    const same = (s: TermSession) => isSameProject(s.projectPath, projectPath)

    // 1) Current tab, same project, idle (or allowBusy) → reuse
    if (active && same(active)) {
      if (!active.connected) {
        // Still booting — never spawn a duplicate for the same click burst
        return active.id
      }
      if (!active.running || allowBusy) {
        return active.id
      }
    }

    // 2) Any other same-project idle connected tab
    const idle = sessions.find((s) => same(s) && s.connected && !s.running)
    if (idle) {
      set({ activeId: idle.id })
      return idle.id
    }

    // 3) Same-project tab still connecting
    const pending = sessions.find((s) => same(s) && !s.connected)
    if (pending) {
      set({ activeId: pending.id })
      return pending.id
    }

    // 4) Busy (or none) → new tab
    return createSession(projectPath, projectName)
  },

  runInSession: async (terminalId, _projectPath, command) => {
    const cmd = command.trim()
    if (!cmd) return
    try {
      await waitPtyReady(terminalId)
      get().markRunning(terminalId, true)
      // PowerShell / cmd both accept \r as Enter in ConPTY
      await invoke('pty_write', { terminalId, data: `${cmd}\r` })
    } catch (e) {
      get().markRunning(terminalId, false)
      writeToTerminal(terminalId, `\r\n\x1b[31mError: ${String(e)}\x1b[0m\r\n`)
    }
  },

  runScript: async (projectPath, projectName, pm, script) => {
    // npm 必须 `run`；pnpm / yarn / bun 可省略
    const command = pm === 'npm' ? `npm run ${script}` : `${pm} ${script}`
    void useSettingsStore.getState().touchCommandHistory(projectPath, command)
    await get().runRaw(projectPath, projectName, command)
  },

  runRaw: async (projectPath, projectName, command) => {
    const id = get().ensureRunTarget(projectPath, projectName)
    await get().runInSession(id, projectPath, command)
  },

  startListening: async () => {
    if (!isTauri()) {
      return () => undefined
    }
    const unData = await listen<PtyDataEvent>('pty://data', (event) => {
      const id = event.payload.terminalId
      writeToTerminal(id, event.payload.data)
      const session = get().sessions.find((t) => t.id === id)
      if (session?.running && looksLikeShellPrompt(event.payload.data)) {
        get().markRunning(id, false)
      }
    })
    const unExit = await listen<PtyExitEvent>('pty://exit', (event) => {
      const id = event.payload.terminalId
      get().markConnected(id, false)
      const code = event.payload.code
      const msg =
        code == null
          ? '\r\n\x1b[90m[shell closed]\x1b[0m\r\n'
          : `\r\n\x1b[90m[shell exit ${code}]\x1b[0m\r\n`
      writeToTerminal(id, msg)
    })
    return () => {
      unData()
      unExit()
    }
  },
}))
