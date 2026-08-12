import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import type { MergeFileEntry, MergeStatus } from '../lib/types'
import { useProjectStore } from '../stores/projectStore'
import { MergeEditorModal } from './MergeEditorModal'
import { ModalShell } from './ModalShell'

type Props = {
  projectPath: string
  /** Optional initial status (avoids flash). */
  initial?: MergeStatus | null
  onClose: () => void
  onDone: () => void
}

export function MergeConflictModal({
  projectPath,
  initial,
  onClose,
  onDone,
}: Props) {
  const { t } = useI18n()
  const refreshGit = useProjectStore((s) => s.refreshGit)
  const refreshMergeStatus = useProjectStore((s) => s.refreshMergeStatus)
  const [status, setStatus] = useState<MergeStatus | null>(initial ?? null)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diffFile, setDiffFile] = useState<string | null>(null)
  const [confirmCommit, setConfirmCommit] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')

  const reload = useCallback(async () => {
    const next = await invoke<MergeStatus>('git_merge_status', {
      path: projectPath,
    })
    setStatus(next)
    await refreshMergeStatus()
    return next
  }, [projectPath, refreshMergeStatus])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await invoke<MergeStatus>('git_merge_status', {
          path: projectPath,
        })
        if (!cancelled) setStatus(next)
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectPath])

  useEffect(() => {
    if (!status) return
    if (!selected && status.files.length > 0) {
      const firstConflict = status.files.find((f) => f.conflict)
      setSelected(firstConflict?.path ?? status.files[0]?.path ?? null)
    }
    if (status.incoming) {
      setCommitMsg((prev) =>
        prev
          ? prev
          : t('merge.commitDefault', { name: status.incoming ?? 'branch' }),
      )
    }
  }, [status, selected, t])

  const selectedEntry: MergeFileEntry | undefined = status?.files.find(
    (f) => f.path === selected,
  )

  // Conflicts without MERGE_HEAD = stash-pop conflicts (e.g. the auto-stash
  // restored before an update clashes with pulled changes).
  const stashMode = !!status && !status.inProgress && status.files.length > 0

  const resolveSide = async (ours: boolean) => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const next = await invoke<MergeStatus>('git_merge_resolve_ours_theirs', {
        path: projectPath,
        file: selected,
        ours,
      })
      setStatus(next)
      await refreshMergeStatus()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const abortMerge = async () => {
    if (!window.confirm(t('merge.abortConfirm'))) return
    setBusy(true)
    setError(null)
    try {
      await invoke<string>('git_merge_abort', { path: projectPath })
      await refreshGit()
      await refreshMergeStatus()
      onDone()
      onClose()
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  const finishMerge = async () => {
    setBusy(true)
    setError(null)
    try {
      await invoke<string>('git_merge_commit', {
        path: projectPath,
        message: commitMsg.trim() || null,
      })
      setConfirmCommit(false)
      // The pre-pull auto-stash is restored after the merge commit; if THAT
      // restores into conflicts there is no MERGE_HEAD — stay open in
      // stash-pop mode so the user can resolve them too.
      const next = await invoke<MergeStatus>('git_merge_status', {
        path: projectPath,
      }).catch(() => null)
      if (next && next.conflictCount > 0 && !next.inProgress) {
        setStatus(next)
        setSelected(null)
        await refreshMergeStatus()
        setBusy(false)
        return
      }
      await refreshGit()
      await refreshMergeStatus()
      onDone()
      onClose()
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  const finishStash = async () => {
    setBusy(true)
    setError(null)
    try {
      await invoke<string>('git_stash_finish_pop', { path: projectPath })
      await refreshGit()
      await refreshMergeStatus()
      onDone()
      onClose()
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  const title = status
    ? stashMode
      ? t('merge.stashTitle')
      : t('merge.title', {
          incoming: status.incoming ?? '?',
          current: status.current ?? '?',
        })
    : t('merge.titleLoading')

  return (
    <>
      <ModalShell
        title={title}
        onClose={onClose}
        wide
        className="merge-conflict-modal"
        closeOnEsc={!busy}
        footer={status ? (
          <div className="modal-actions merge-footer">
            {!stashMode && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void abortMerge()}
              >
                {t('merge.abort')}
              </button>
            )}
            {stashMode ? (
              <button
                type="button"
                className="btn primary"
                disabled={busy || status.conflictCount > 0}
                onClick={() => void finishStash()}
                title={t('merge.stashFinishHint')}
              >
                {t('merge.stashFinish')}
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                disabled={busy || (status.conflictCount ?? 0) > 0 || !status.inProgress}
                onClick={() => setConfirmCommit(true)}
              >
                {t('merge.finish')}
              </button>
            )}
          </div>
        ) : undefined}
      >
        {error && <div className="status-banner dirty">{error}</div>}
        {!status && !error && (
          <div className="muted">{t('merge.loading')}</div>
        )}
        {status && (
          <>
            <p className="muted merge-summary">
              {status.conflictCount > 0
                ? stashMode
                  ? t('merge.stashSummary', { n: status.conflictCount })
                  : t('merge.conflictSummary', { n: status.conflictCount })
                : status.inProgress
                  ? t('merge.pendingSummary', { n: status.files.length })
                  : t('merge.stashResolved')}
            </p>
            <div className="merge-file-list" role="listbox">
              {status.files.length === 0 ? (
                <div className="muted">{t('merge.filesEmpty')}</div>
              ) : (
                status.files.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    role="option"
                    aria-selected={selected === f.path}
                    className={`merge-file-row${
                      f.conflict ? ' is-conflict' : ' is-clean'
                    }${selected === f.path ? ' is-selected' : ''}`}
                    onClick={() => setSelected(f.path)}
                    onDoubleClick={() => {
                      if (f.conflict) setDiffFile(f.path)
                    }}
                  >
                    <span className="merge-file-path">{f.path}</span>
                    <span className="merge-file-meta">
                      {f.conflict
                        ? t('merge.fileConflict')
                        : f.label || f.code}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="merge-actions-row">
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || !selectedEntry?.conflict}
                onClick={() => void resolveSide(true)}
              >
                {t('merge.useOurs')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || !selectedEntry?.conflict}
                onClick={() => void resolveSide(false)}
              >
                {t('merge.useTheirs')}
              </button>
              <button
                type="button"
                className="btn btn-sm primary"
                disabled={busy || !selectedEntry?.conflict}
                onClick={() => selected && setDiffFile(selected)}
              >
                {t('merge.openDiff')}
              </button>
            </div>
          </>
        )}
      </ModalShell>

      {diffFile && (
        <MergeEditorModal
          projectPath={projectPath}
          file={diffFile}
          onClose={() => setDiffFile(null)}
          onSaved={async () => {
            setDiffFile(null)
            await reload()
          }}
        />
      )}

      {confirmCommit && (
        <ModalShell
          title={t('merge.finishTitle')}
          onClose={() => setConfirmCommit(false)}
          elevated
          closeOnEsc={!busy}
          footer={
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setConfirmCommit(false)}
              >
                {t('branch.cancel')}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void finishMerge()}
              >
                {busy ? t('merge.finishing') : t('merge.finish')}
              </button>
            </div>
          }
        >
          <p className="muted">{t('merge.finishHint')}</p>
          <textarea
            className="merge-commit-input"
            rows={3}
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            disabled={busy}
          />
        </ModalShell>
      )}
    </>
  )
}
