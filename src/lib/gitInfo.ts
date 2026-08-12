import type { GitInfo } from './types'

/**
 * Single source of truth for the "pending update" number shown on a project
 * row: the max behind count across ALL branches (each branch vs its own
 * upstream / same-named remote ref) from one GitInfo snapshot. Both the
 * Explorer project badge and the GitToolPanel branch badges render from the
 * same cached GitInfo, so deriving this value keeps them consistent.
 */
export function maxBranchBehind(git?: GitInfo | null): number {
  if (!git?.branches) return 0
  let max = 0
  for (const b of git.branches) {
    if (b.behind > max) max = b.behind
  }
  return max
}
