import { CheckCircleOutlined } from '@ant-design/icons'
import { ArrowRight } from 'reicon-react'
import { Button } from 'antd'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import type { GitStatus } from '../lib/types'
import { showErrorLog } from '../stores/errorLogStore'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { ModalShell } from './ModalShell'

type Props = {
  branch: string
  onClose: () => void
}

export function BranchSwitchModal({ branch, onClose }: Props) {
  const selected = useProjectStore((s) => s.selected)
  const refresh = useProjectStore((s) => s.refresh)
  const touchBranchHistory = useSettingsStore((s) => s.touchBranchHistory)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Git failures go to the copyable error modal; this flag only exits
  // the clean auto-switch progress view so the user can retry.
  const [failed, setFailed] = useState(false)
  const { t } = useI18n()

  const showGitError = (e: unknown) => {
    showErrorLog(e, t('error.gitFailed'))
  }

  const doSwitch = async () => {
    if (!selected) return
    setSwitching(true)
    setError(null)
    try {
      await invoke<string>('git_checkout', {
        path: selected.path,
        branch,
      })
      await touchBranchHistory(selected.path, branch)
      await refresh()
      onClose()
    } catch (e) {
      showGitError(e)
      setSwitching(false)
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!selected) {
      setLoading(false)
      setError(t('branch.noProject'))
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void invoke<GitStatus>('git_status', { path: selected.path })
      .then(async (s) => {
        if (cancelled) return
        setStatus(s)
        // Clean working tree → switch immediately, no confirm dialog.
        if (s.clean) {
          setSwitching(true)
          try {
            await invoke<string>('git_checkout', {
              path: selected.path,
              branch,
            })
            if (cancelled) return
            await touchBranchHistory(selected.path, branch)
            await refresh()
            if (!cancelled) onClose()
          } catch (e) {
            if (!cancelled) {
              showGitError(e)
              setFailed(true)
              setSwitching(false)
              setLoading(false)
            }
          }
          return
        }
        setLoading(false)
      })
      .catch((e) => {
        if (!cancelled) {
          showGitError(e)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run for project/branch
  }, [selected, branch, t])

  // Clean auto-switch: keep a lightweight progress shell until done/error.
  if (loading || (status?.clean && !error && !failed)) {
    return (
      <ModalShell
        title={t('branch.confirmTitle')}
        onClose={onClose}
        closeOnEsc={false}
        className="branch-modal"
      >
        <p className="muted">
          {switching || status?.clean
            ? t('branch.switching')
            : t('branch.checking')}
        </p>
      </ModalShell>
    )
  }

  return (
    <ModalShell
      title={t('branch.confirmTitle')}
      onClose={onClose}
      closeOnEsc={false}
      className="branch-modal"
      footer={
        <>
          <Button onClick={onClose} disabled={switching}>
            {t('branch.cancel')}
          </Button>
          <Button
            type="primary"
            disabled={switching || !selected}
            onClick={() => void doSwitch()}
            icon={<CheckCircleOutlined />}
          >
            {switching ? t('branch.switching') : t('branch.confirm')}
          </Button>
        </>
      }
    >
      <p className="branch-switch-path">
        <span className="muted">{t('branch.from')}</span>{' '}
        <strong>{status?.current ?? '—'}</strong>{' '}
        <span className="muted inline-icon" aria-hidden>
          <ArrowRight size={14} color="currentColor" />
        </span>{' '}
        <strong className="cyan-text">{branch}</strong>
      </p>

      {status && !status.clean && (
        <div className="status-banner dirty">
          <div className="status-title">
            {t('branch.dirtyTitle', { count: status.entries.length })}
          </div>
          <div className="muted" style={{ marginBottom: 8 }}>
            {t('branch.dirtyDesc')}
          </div>
          <div className="dirty-list">
            {status.entries.map((e) => (
              <div key={`${e.code}-${e.path}`} className="dirty-item">
                <span className="dirty-code">{e.label}</span>
                <span className="dirty-path">{e.path}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="status-banner dirty" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
    </ModalShell>
  )
}
