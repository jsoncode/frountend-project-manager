/** Normalize path separators for prefix comparison. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function shortWorkspaceName(ws: string): string {
  return ws.split(/[/\\]/).filter(Boolean).slice(-1)[0] || ws
}

/**
 * Find which configured workspace root owns `projectPath`.
 * Prefers the longest matching prefix (nested roots).
 */
export function findWorkspaceForPath(
  projectPath: string,
  workspaces: string[],
): string | null {
  const target = normalizePath(projectPath).toLowerCase()
  let best: string | null = null
  let bestLen = -1
  for (const ws of workspaces) {
    const root = normalizePath(ws).toLowerCase()
    if (!root) continue
    if (target === root || target.startsWith(`${root}/`)) {
      if (root.length > bestLen) {
        best = ws
        bestLen = root.length
      }
    }
  }
  return best
}
