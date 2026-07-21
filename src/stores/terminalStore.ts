import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { create } from 'zustand'
import { isTauri } from '../lib/tauri'
import type { TermSession, TerminalLine } from '../lib/types'
import { useSettingsStore } from './settingsStore'

let seq = 1

function newId() {
  return `term-${Date.now()}-${seq++}`
}

type TerminalState = {
  sessions: TermSession[]
  activeId: string | null
  createSession: (projectPath: string, projectName: string) => string
  closeSession: (id: string) => Promise<void>
  setActive: (id: string) => void
  setInput: (id: string, value: string) => void
  clearSession: (id: string) => void
  append: (line: TerminalLine) => void
  appendBatch: (lines: TerminalLine[]) => void
  /** Prefer idle active tab for project; otherwise create a new tab. */
  ensureRunTarget: (projectPath: string, projectName: string) => string
  runInSession: (terminalId: string, projectPath: string, command: string) => Promise<void>
  runScript: (projectPath: string, projectName: string, pm: string, script: string) => Promise<void>
  runRaw: (projectPath: string, projectName: string, command: string) => Promise<void>
  killSession: (id: string) => Promise<void>
  writeStdin: (id: string, data: string, echo?: string) => Promise<void>
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
      lines: [
        {
          terminalId: id,
          projectPath,
          stream: 'system',
          line: `cwd: ${projectPath}`,
        },
      ],
      running: false,
      input: '',
    }
    set((s) => ({
      sessions: [...s.sessions, session],
      activeId: id,
    }))
    return id
  },

  closeSession: async (id) => {
    const session = get().sessions.find((s) => s.id === id)
    if (session?.running) {
      await get().killSession(id)
    }
    set((s) => {
      const sessions = s.sessions.filter((t) => t.id !== id)
      const activeId =
        s.activeId === id ? (sessions[sessions.length - 1]?.id ?? null) : s.activeId
      return { sessions, activeId }
    })
  },

  setActive: (id) => set({ activeId: id }),

  setInput: (id, value) =>
    set((s) => ({
      sessions: s.sessions.map((t) => (t.id === id ? { ...t, input: value } : t)),
    })),

  clearSession: (id) =>
    set((s) => ({
      sessions: s.sessions.map((t) =>
        t.id === id ? { ...t, lines: [] } : t,
      ),
    })),

  append: (line) => get().appendBatch([line]),

  appendBatch: (incoming) => {
    if (incoming.length === 0) return
    set((s) => {
      const byId = new Map<string, TerminalLine[]>()
      let stoppedIds = new Set<string>()
      for (const line of incoming) {
        const list = byId.get(line.terminalId) ?? []
        list.push(line)
        byId.set(line.terminalId, list)
        if (
          line.stream === 'system' &&
          (line.line.startsWith('[exit') || line.line.startsWith('[stopped'))
        ) {
          stoppedIds.add(line.terminalId)
        }
      }
      return {
        sessions: s.sessions.map((t) => {
          const extra = byId.get(t.id)
          if (!extra) return t
          return {
            ...t,
            lines: [...t.lines, ...extra].slice(-800),
            running: stoppedIds.has(t.id) ? false : t.running,
          }
        }),
      }
    })
  },

  ensureRunTarget: (projectPath, projectName) => {
    const { sessions, activeId, createSession } = get()
    const active = sessions.find((s) => s.id === activeId)
    if (active && active.projectPath === projectPath && !active.running) {
      return active.id
    }
    const idle = sessions.find(
      (s) => s.projectPath === projectPath && !s.running,
    )
    if (idle) {
      set({ activeId: idle.id })
      return idle.id
    }
    return createSession(projectPath, projectName)
  },

  runInSession: async (terminalId, projectPath, command) => {
    set((s) => ({
      sessions: s.sessions.map((t) =>
        t.id === terminalId ? { ...t, running: true, input: '' } : t,
      ),
    }))
    try {
      await invoke('run_command', { terminalId, projectPath, command })
    } catch (e) {
      get().append({
        terminalId,
        projectPath,
        stream: 'system',
        line: `Error: ${String(e)}`,
      })
      set((s) => ({
        sessions: s.sessions.map((t) =>
          t.id === terminalId ? { ...t, running: false } : t,
        ),
      }))
    }
  },

  runScript: async (projectPath, projectName, pm, script) => {
    const command =
      pm === 'npm' ? `npm run ${script}` : `${pm} run ${script}`
    // Only package.json scripts go into the command execution history.
    void useSettingsStore.getState().touchCommandHistory(projectPath, command)
    await get().runRaw(projectPath, projectName, command)
  },

  runRaw: async (projectPath, projectName, command) => {
    const id = get().ensureRunTarget(projectPath, projectName)
    await get().runInSession(id, projectPath, command)
  },

  killSession: async (id) => {
    try {
      await invoke('kill_command', { terminalId: id })
    } finally {
      set((s) => ({
        sessions: s.sessions.map((t) =>
          t.id === id ? { ...t, running: false } : t,
        ),
      }))
    }
  },

  writeStdin: async (id, data, echo) => {
    const session = get().sessions.find((s) => s.id === id)
    if (!session?.running) return
    if (echo != null && echo.length > 0) {
      get().append({
        terminalId: id,
        projectPath: session.projectPath,
        stream: 'stdin',
        line: echo,
      })
    }
    try {
      await invoke('write_terminal_stdin', { terminalId: id, data })
    } catch (e) {
      get().append({
        terminalId: id,
        projectPath: session.projectPath,
        stream: 'system',
        line: `stdin error: ${String(e)}`,
      })
    }
  },

  startListening: async () => {
    if (!isTauri()) {
      return () => undefined
    }
    // Coalesce high-frequency pipe chunks into one React update per frame.
    let queue: TerminalLine[] = []
    let raf = 0
    const flush = () => {
      raf = 0
      if (queue.length === 0) return
      const batch = queue
      queue = []
      get().appendBatch(batch)
    }
    return listen<TerminalLine>('terminal://line', (event) => {
      queue.push(event.payload)
      if (!raf) {
        raf = requestAnimationFrame(flush)
      }
    })
  },
}))
