import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import type { MergeStatus } from '../lib/types'
import { showErrorLog } from '../stores/errorLogStore'
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

  const hasPaths = paths && paths.length > 0

  const doCommit = async (push: boolean) => {
    const msg = commitMsg.trim()
    if (!msg || busy) return
    setBusy(true)
    setBusyLabel(push ? t('git.pushing') : t('git.committing'))

    try {
      // Backend-driven: stage → commit → optional push in one call,
      // no terminal session required.
      await invoke<string>('git_commit', {
        path: projectPath,
        message: msg,
        paths: paths ?? [],
        push,
      })

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
      // Failure details go to the dedicated copyable error modal;
      // the commit modal stays open so the message can be retried.
      showErrorLog(e, t('error.gitFailed'))
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
        onChange={(e) => {
          setCommitMsg(e.target.value)
        }}
        placeholder={t('git.commitPlaceholder')}
        disabled={busy}
        autoFocus
      />
    </ModalShell>
  )
}
