import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'

type Entry = {
  term: Terminal
  fit: FitAddon
  ready: Promise<void>
  resolveReady: () => void
}

const entries = new Map<string, Entry>()

export function createReadyGate(): {
  ready: Promise<void>
  resolveReady: () => void
} {
  let resolveReady: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    resolveReady = () => resolve()
  })
  return { ready, resolveReady }
}

export function registerPtyTerminal(
  id: string,
  term: Terminal,
  fit: FitAddon,
  gate: { ready: Promise<void>; resolveReady: () => void },
) {
  entries.set(id, { term, fit, ready: gate.ready, resolveReady: gate.resolveReady })
}

export function unregisterPtyTerminal(id: string) {
  const entry = entries.get(id)
  if (entry) {
    try {
      entry.term.dispose()
    } catch {
      /* ignore */
    }
    entries.delete(id)
  }
}

export function markPtyReady(id: string) {
  entries.get(id)?.resolveReady()
}

export async function waitPtyReady(id: string, timeoutMs = 8000): Promise<void> {
  const entry = entries.get(id)
  if (!entry) {
    // Xterm may not have mounted yet — poll briefly
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const e = entries.get(id)
      if (e) {
        await Promise.race([
          e.ready,
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('PTY ready timeout')), timeoutMs),
          ),
        ])
        return
      }
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('终端尚未就绪')
  }
  await Promise.race([
    entry.ready,
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('PTY ready timeout')), timeoutMs),
    ),
  ])
}

export function writeToTerminal(id: string, data: string) {
  entries.get(id)?.term.write(data)
}

export function clearTerminal(id: string) {
  entries.get(id)?.term.clear()
}

export function focusTerminal(id: string) {
  entries.get(id)?.term.focus()
}

export function fitTerminal(id: string) {
  const entry = entries.get(id)
  if (!entry) return
  try {
    entry.fit.fit()
  } catch {
    /* ignore layout races */
  }
}

export function getTerminalSize(id: string): { cols: number; rows: number } | null {
  const term = entries.get(id)?.term
  if (!term) return null
  return { cols: term.cols, rows: term.rows }
}
