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

type PtyDataEvent = { terminalId: string; data: string }
type PtyExitEvent = { terminalId: string; code?: number | null }

type TerminalState = {
  sessions: TermSession[]
  activeId: string | null
  createSession: (projectPath: string, projectName: string) => string
  closeSession: (id: string) => Promise<void>
  setActive: (id: string) => void
  /** Prefer connected active tab for project; otherwise create a new tab. */
  ensureRunTarget: (projectPath: string, projectName: string) => string
  runInSession: (terminalId: string, projectPath: string, command: string) => Promise<void>
  runScript: (projectPath: string, projectName: string, pm: string, script: string) => Promise<void>
  runRaw: (projectPath: string, projectName: string, command: string) => Promise<void>
  markConnected: (id: string, connected: boolean) => void
  startListening: () => Promise<UnlistenFn>
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  activeId: null,

  createSession: (projectPath, projectName) => {
    const id = newId()
    const count =
      get().sessions.filter((s) => s.projectPath === projectPath).length + 1
    const session: TermSession = {
      id,
      title: `${projectName} #${count}`,
      projectPath,
      projectName,
      connected: false,
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
      sessions: s.sessions.map((t) => (t.id === id ? { ...t, connected } : t)),
    })),

  ensureRunTarget: (projectPath, projectName) => {
    const { sessions, activeId, createSession } = get()
    const active = sessions.find((s) => s.id === activeId)
    if (active && active.projectPath === projectPath && active.connected) {
      return active.id
    }
    const idle = sessions.find(
      (s) => s.projectPath === projectPath && s.connected,
    )
    if (idle) {
      set({ activeId: idle.id })
      return idle.id
    }
    return createSession(projectPath, projectName)
  },

  runInSession: async (terminalId, _projectPath, command) => {
    const cmd = command.trim()
    if (!cmd) return
    try {
      await waitPtyReady(terminalId)
      // PowerShell / cmd both accept \r as Enter in ConPTY
      await invoke('pty_write', { terminalId, data: `${cmd}\r` })
    } catch (e) {
      writeToTerminal(terminalId, `\r\n\x1b[31mError: ${String(e)}\x1b[0m\r\n`)
    }
  },

  runScript: async (projectPath, projectName, pm, script) => {
    const command =
      pm === 'npm' ? `npm run ${script}` : `${pm} run ${script}`
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
      writeToTerminal(event.payload.terminalId, event.payload.data)
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
