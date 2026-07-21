import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import type { GitStatus } from '../lib/types'
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
  const { t } = useI18n()

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
      .then((s) => {
        if (!cancelled) {
          setStatus(s)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [selected, branch, t])

  const confirm = async () => {
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
      setError(String(e))
      setSwitching(false)
    }
  }

  return (
    <ModalShell title={t('branch.confirmTitle')} onClose={onClose} className="branch-modal">
      <p className="branch-switch-path">
        <span className="muted">{t('branch.from')}</span>{' '}
        <strong>{status?.current ?? '—'}</strong>{' '}
        <span className="muted">→</span>{' '}
        <strong className="cyan-text">{branch}</strong>
      </p>

      {loading && <p className="muted">{t('branch.checking')}</p>}

      {!loading && status?.clean && (
        <div className="status-banner clean">
          <div className="status-title">{t('branch.cleanTitle')}</div>
          <div className="muted">{t('branch.cleanDesc')}</div>
        </div>
      )}

      {!loading && status && !status.clean && (
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

      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose} disabled={switching}>
          {t('branch.cancel')}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={loading || switching || !selected}
          onClick={() => void confirm()}
        >
          {switching ? t('branch.switching') : t('branch.confirm')}
        </button>
      </div>
    </ModalShell>
  )
}
