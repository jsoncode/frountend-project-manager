import { useEffect, useState, type MouseEvent } from 'react'
import { useI18n } from '../i18n/useI18n'
import type { BranchItem } from '../lib/types'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTerminalStore } from '../stores/terminalStore'
import { BranchSwitchModal } from './BranchSwitchModal'
import { HistoryChips } from './HistoryChips'
import { ModalShell } from './ModalShell'

type MenuState = {
  x: number
  y: number
  branch: BranchItem
}

export function GitToolPanel() {
  const selected = useProjectStore((s) => s.selected)
  const git = useProjectStore((s) => s.git)
  const refreshGit = useProjectStore((s) => s.refreshGit)
  const config = useSettingsStore((s) => s.config)
  const setHistoryPinned = useSettingsStore((s) => s.setHistoryPinned)
  const deleteHistory = useSettingsStore((s) => s.deleteHistory)
  const runRaw = useTerminalStore((s) => s.runRaw)
  const [switchTarget, setSwitchTarget] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [commitTarget, setCommitTarget] = useState<string | null>(null)
  const [commitMsg, setCommitMsg] = useState('')
  const [checking, setChecking] = useState(false)
  const { t } = useI18n()

  const branchHistory =
    selected && config ? (config.branchHistory?.[selected.path] ?? []) : []

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  if (!selected) return null

  const runGit = (command: string) => {
    void runRaw(selected.path, selected.folderName, command)
  }

  const checkUpdates = async () => {
    setChecking(true)
    try {
      await refreshGit({ fetch: true })
    } finally {
      setChecking(false)
    }
  }

  const localName = (name: string) =>
    name.replace(/^remotes\//, '').replace(/^origin\//, '')

  const onContext = (e: MouseEvent, branch: BranchItem) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, branch })
  }

  const doCommit = () => {
    const msg = commitMsg.trim()
    if (!msg || !commitTarget) return
    const branch = commitTarget
    setCommitTarget(null)
    setCommitMsg('')
    const quoted = JSON.stringify(msg)
    const cmds =
      git?.current === branch || branch.startsWith('origin/')
        ? `git add -A && git commit -m ${quoted}`
        : `git switch ${JSON.stringify(localName(branch))} && git add -A && git commit -m ${quoted}`
    runGit(cmds)
  }

  const pullCmd = (branch: BranchItem) => {
    if (branch.isRemote) {
      const short = localName(branch.name)
      return `git pull origin ${JSON.stringify(short)}`
    }
    return 'git pull'
  }

  return (
    <>
      <div className="git-toolbar">
        <button
          type="button"
          className="btn btn-sm primary"
          disabled={checking}
          onClick={() => void checkUpdates()}
        >
          {checking ? t('git.checking') : t('git.checkUpdates')}
        </button>
      </div>
      <p className="muted" style={{ margin: '0 0 8px' }}>
        {t('git.hint')}
      </p>
      <HistoryChips
        title={t('git.history')}
        items={branchHistory}
        emptyText={t('git.historyEmpty')}
        onRun={(branch) => {
          if (git?.current !== branch) setSwitchTarget(branch)
        }}
        onTogglePin={(value, pinned) =>
          void setHistoryPinned(selected.path, 'branch', value, pinned)
        }
        onDelete={(value) => void deleteHistory(selected.path, 'branch', value)}
      />
      <div className="pane-sub" style={{ marginTop: 10 }}>
        {t('git.allBranches')}
      </div>
      {!git && <div className="muted">{t('git.notRepo')}</div>}
      <div className="branch-list">
        {(git?.branches ?? []).map((b) => {
          const isCurrent = git?.current === b.name
          return (
            <div
              key={b.name}
              className={`branch-item ${isCurrent ? 'current' : ''} clickable`}
              title={
                isCurrent
                  ? t('git.current')
                  : `${t('git.dblclick')} · ${t('git.contextHint')}`
              }
              onDoubleClick={() => {
                if (!isCurrent) setSwitchTarget(b.name)
              }}
              onContextMenu={(e) => onContext(e, b)}
            >
              <span className="branch-mark">{isCurrent ? '●' : '○'}</span>
              <span className="branch-name">{b.name}</span>
              {b.behind > 0 && (
                <span
                  className="branch-badge behind"
                  title={t('git.behindHint', { n: b.behind })}
                >
                  ↓{b.behind}
                </span>
              )}
              {b.ahead > 0 && (
                <span
                  className="branch-badge ahead"
                  title={t('git.aheadHint', { n: b.ahead })}
                >
                  ↑{b.ahead}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {menu && (
        <div
          className="branch-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {!menu.branch.isRemote && git?.current !== menu.branch.name && (
            <button
              type="button"
              onClick={() => {
                setSwitchTarget(menu.branch.name)
                setMenu(null)
              }}
            >
              {t('git.ctx.checkout')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              runGit(pullCmd(menu.branch))
              setMenu(null)
            }}
          >
            {t('git.ctx.pull')}
          </button>
          {!menu.branch.isRemote && (
            <button
              type="button"
              onClick={() => {
                runGit('git push')
                setMenu(null)
              }}
            >
              {t('git.ctx.push')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              runGit('git fetch --all --prune')
              setMenu(null)
              void refreshGit()
            }}
          >
            {t('git.ctx.fetch')}
          </button>
          {!menu.branch.isRemote && (
            <button
              type="button"
              onClick={() => {
                setCommitTarget(menu.branch.name)
                setMenu(null)
              }}
            >
              {t('git.ctx.commit')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              runGit('git status')
              setMenu(null)
            }}
          >
            {t('git.ctx.status')}
          </button>
          <button
            type="button"
            onClick={() => {
              runGit('git log --oneline -20')
              setMenu(null)
            }}
          >
            {t('git.ctx.log')}
          </button>
        </div>
      )}

      {commitTarget && (
        <ModalShell title={t('git.commitTitle')} onClose={() => setCommitTarget(null)}>
          <p className="muted">{t('git.commitHint', { name: commitTarget })}</p>
          <textarea
            className="git-commit-input"
            rows={4}
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder={t('git.commitPlaceholder')}
            autoFocus
          />
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setCommitTarget(null)}>
              {t('branch.cancel')}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!commitMsg.trim()}
              onClick={doCommit}
            >
              {t('git.ctx.commit')}
            </button>
          </div>
        </ModalShell>
      )}

      {switchTarget && (
        <BranchSwitchModal
          branch={switchTarget}
          onClose={() => setSwitchTarget(null)}
        />
      )}
    </>
  )
}
