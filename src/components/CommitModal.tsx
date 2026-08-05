import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { writeHostToTerminal } from '../lib/ptyHost'
import type { MergeStatus } from '../lib/types'
import { useTerminalStore } from '../stores/terminalStore'
import { MergeConflictModal } from './MergeConflictModal'
import { ModalShell } from './ModalShell'

type Props = {
  projectPath: string
  projectName: string
  branch: string
  /** When provided, only these paths are staged (partial commit). */
  paths?: string[]
  /** Show a "Commit & Push" button in addition to "Commit". */
  showPush?: boolean
  onClose: () => void
  onDone: () => void
}

export function CommitModal({
  projectPath,
  projectName,
  branch,
  paths,
  showPush,
  onClose,
  onDone,
}: Props) {
  const [commitMsg, setCommitMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [mergeModal, setMergeModal] = useState<MergeStatus | null>(null)
  const { t } = useI18n()

  const ensureRunTarget = useTerminalStore((s) => s.ensureRunTarget)
  const runInSession = useTerminalStore((s) => s.runInSession)
  const waitUntilIdle = useTerminalStore((s) => s.waitUntilIdle)

  const hasPaths = paths && paths.length > 0

  /** Run a git command in the PTY and wait for the prompt. */
  const runGitInTerm = async (command: string) => {
    const id = ensureRunTarget(projectPath, projectName)
    await runInSession(id, projectPath, command)
    await waitUntilIdle(id)
  }

  const echoTerm = (text: string) => {
    const id = ensureRunTarget(projectPath, projectName, { allowBusy: true })
    writeHostToTerminal(id, text)
  }

  const buildCommitCommands = (msg: string, push: boolean): string[] => {
    const quoted = JSON.stringify(msg)
    const cmds: string[] = []

    // Stage
    if (hasPaths) {
      const escaped = paths!.map((p) => JSON.stringify(p)).join(' ')
      cmds.push(`git add ${escaped}`)
    } else {
      cmds.push('git add -A')
    }

    // Commit
    cmds.push(`git commit -m ${quoted}`)

    // Push (optional)
    if (push) {
      cmds.push('git push')
    }

    return cmds
  }

  const doCommit = async (push: boolean) => {
    const msg = commitMsg.trim()
    if (!msg || busy) return
    setBusy(true)
    setBusyLabel(push ? t('git.pushing') : t('git.committing'))

    try {
      const cmds = buildCommitCommands(msg, push)
      const chain = cmds.join('; if ($?) { ') + ' }'.repeat(cmds.length - 1)

      echoTerm(`\r\n\x1b[36m$ ${cmds.join(' && ')}\x1b[0m\r\n`)
      await runGitInTerm(chain)

      // Check for merge conflicts after commit (unlikely but possible with hooks)
      const status = await invoke<MergeStatus>('git_merge_status', {
        path: projectPath,
      }).catch(() => null)

      if (status && (status.inProgress || status.conflictCount > 0)) {
        setMergeModal(status)
        return // Don't close — show merge modal
      }

      onDone()
    } catch (e) {
      echoTerm(`\r\n\x1b[31m${String(e)}\x1b[0m\r\n`)
    } finally {
      setBusy(false)
      setBusyLabel('')
    }
  }

  if (mergeModal) {
    return (
      <MergeConflictModal
        projectPath={projectPath}
        initial={mergeModal}
        onClose={() => {
          setMergeModal(null)
          onClose()
        }}
        onDone={() => {
          setMergeModal(null)
          onDone()
        }}
      />
    )
  }

  return (
    <ModalShell
      title={t('git.commitTitle')}
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={busy}
          >
            {t('branch.cancel')}
          </button>
          {showPush && (
            <button
              type="button"
              className="btn primary btn-with-icon"
              disabled={!commitMsg.trim() || busy}
              onClick={() => void doCommit(true)}
            >
              {busy && busyLabel === t('git.pushing')
                ? busyLabel
                : t('git.commitPush')}
            </button>
          )}
          <button
            type="button"
            className="btn primary btn-with-icon"
            disabled={!commitMsg.trim() || busy}
            onClick={() => void doCommit(false)}
          >
            {busy && busyLabel === t('git.committing')
              ? busyLabel
              : t('git.ctx.commit').replace('…', '')}
          </button>
        </div>
      }
    >
      <p className="muted">
        {showPush
          ? t('git.commitPushHint', { name: branch })
          : t('git.commitHint', { name: branch })}
      </p>
      {hasPaths && (
        <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>
          {t('git.commitPathsHint', { n: paths!.length })}
          <div
            style={{
              marginTop: 4,
              maxHeight: 80,
              overflow: 'auto',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 11,
              color: 'var(--text-dim)',
              lineHeight: 1.5,
            }}
          >
            {paths!.map((p) => (
              <div key={p} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p}
              </div>
            ))}
          </div>
        </div>
      )}
      <textarea
        className="git-commit-input"
        rows={4}
        value={commitMsg}
        onChange={(e) => setCommitMsg(e.target.value)}
        placeholder={t('git.commitPlaceholder')}
        disabled={busy}
        autoFocus
      />
    </ModalShell>
  )
}
