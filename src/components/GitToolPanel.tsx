import {
  ArrowDown,
  ArrowUp,
  BranchDown,
  CheckCircle,
  Refresh,
} from 'reicon-react'
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useState, type MouseEvent } from 'react'
import { useI18n } from '../i18n/useI18n'
import { writeToTerminal } from '../lib/ptyHost'
import type { BranchItem } from '../lib/types'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTerminalStore } from '../stores/terminalStore'
import { BranchSwitchModal } from './BranchSwitchModal'
import { ContextMenuPortal } from './ContextMenuPortal'
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
  const ensureRunTarget = useTerminalStore((s) => s.ensureRunTarget)
  const [switchTarget, setSwitchTarget] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [commitTarget, setCommitTarget] = useState<string | null>(null)
  const [commitMsg, setCommitMsg] = useState('')
  const [checking, setChecking] = useState(false)
  const [pulling, setPulling] = useState(false)
  const { t } = useI18n()

  const branchHistory =
    selected && config ? (config.branchHistory?.[selected.path] ?? []) : []

  const closeMenu = useCallback(() => setMenu(null), [])

  if (!selected) {
    return <div className="muted">{t('tool.needProject')}</div>
  }

  const runGit = (command: string) => {
    void runRaw(selected.path, selected.folderName, command)
  }

  const echoTerm = (text: string) => {
    const id = ensureRunTarget(selected.path, selected.folderName, {
      allowBusy: true,
    })
    writeToTerminal(id, text)
  }

  const checkUpdates = async () => {
    if (checking) return
    setChecking(true)
    try {
      await refreshGit({ fetch: true })
    } finally {
      setChecking(false)
    }
  }

  const localName = (name: string) =>
    name.replace(/^remotes\//, '').replace(/^origin\//, '')

  const pullBranch = async (branch: BranchItem) => {
    const name = localName(branch.name)
    setPulling(true)
    echoTerm(`\r\n\x1b[36m$ git pull/update ${name}\x1b[0m\r\n`)
    try {
      const msg = await invoke<string>('git_pull_branch', {
        path: selected.path,
        branch: name,
      })
      echoTerm(`\x1b[32m${msg}\x1b[0m\r\n`)
      // Re-read tracking counts (no full remote fetch needed after pull)
      await refreshGit()
    } catch (e) {
      echoTerm(`\x1b[31m${String(e)}\x1b[0m\r\n`)
    } finally {
      setPulling(false)
    }
  }

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
    // Windows PowerShell 5.1 does not support bash-style `&&`.
    // Chain with `; if ($?) { ... }` so a failed step stops the rest.
    const cmds =
      git?.current === branch || branch.startsWith('origin/')
        ? `git add -A; if ($?) { git commit -m ${quoted} }`
        : `git switch ${JSON.stringify(localName(branch))}; if ($?) { git add -A }; if ($?) { git commit -m ${quoted} }`
    runGit(cmds)
  }

  const isMenuCurrent =
    !!menu &&
    !!git?.current &&
    (git.current === menu.branch.name ||
      (!menu.branch.isRemote && git.current === localName(menu.branch.name)))

  // origin/master 与本地 master 视为同一逻辑分支：不合并，可签出
  const sameLocalAsCurrent =
    !!menu && !!git?.current && localName(menu.branch.name) === git.current

  const branches = git?.branches ?? []
  const localBranches = branches.filter((b) => !b.isRemote)
  const remoteBranches = branches.filter((b) => b.isRemote)

  const renderBranch = (b: BranchItem) => {
    const isCurrent = !b.isRemote && git?.current === b.name
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
        <span className="branch-mark" aria-hidden>
          <BranchDown
            size={12}
            color="currentColor"
            weight={isCurrent ? 'Filled' : 'Outline'}
          />
        </span>
        <span className="branch-name">{b.name}</span>
        {b.behind > 0 && (
          <span
            className="branch-badge behind"
            title={t('git.behindHint', { n: b.behind })}
          >
            <ArrowDown className="inline-icon" size={10} color="currentColor" aria-hidden />
            {b.behind}
          </span>
        )}
        {b.ahead > 0 && (
          <span
            className="branch-badge ahead"
            title={t('git.aheadHint', { n: b.ahead })}
          >
            <ArrowUp className="inline-icon" size={10} color="currentColor" aria-hidden />
            {b.ahead}
          </span>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="git-toolbar">
        <button
          type="button"
          className="btn btn-sm primary btn-with-icon"
          disabled={checking || pulling}
          onClick={() => void checkUpdates()}
        >
          <Refresh
            className={`ui-icon${checking ? ' is-spinning' : ''}`}
            size={14}
            color="currentColor"
            aria-hidden
          />
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
      {!git && <div className="muted">{t('git.notRepo')}</div>}
      {git && (
        <>
          <div className="pane-sub" style={{ marginTop: 10 }}>
            {t('git.localBranches')}
          </div>
          <div className="branch-list">
            {localBranches.length === 0 ? (
              <div className="muted">{t('git.branchesEmpty')}</div>
            ) : (
              localBranches.map(renderBranch)
            )}
          </div>
          <div className="pane-sub" style={{ marginTop: 10 }}>
            {t('git.remoteBranches')}
          </div>
          <div className="branch-list">
            {remoteBranches.length === 0 ? (
              <div className="muted">{t('git.branchesEmpty')}</div>
            ) : (
              remoteBranches.map(renderBranch)
            )}
          </div>
        </>
      )}

      {menu && (
        <ContextMenuPortal x={menu.x} y={menu.y} onClose={closeMenu}>
          {(!sameLocalAsCurrent || menu.branch.isRemote) && (
            <button
              type="button"
              role="menuitem"
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
            role="menuitem"
            disabled={pulling}
            onClick={() => {
              const target = menu.branch
              setMenu(null)
              void pullBranch(target)
            }}
          >
            {isMenuCurrent || (menu.branch.isRemote && sameLocalAsCurrent)
              ? t('git.ctx.pull')
              : t('git.ctx.pullOther')}
          </button>
          {!menu.branch.isRemote && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const name = localName(menu.branch.name)
                runGit(
                  isMenuCurrent
                    ? 'git push'
                    : `git push -u origin ${JSON.stringify(name)}:${name}`,
                )
                setMenu(null)
              }}
            >
              {t('git.ctx.push')}
            </button>
          )}
          {(isMenuCurrent || (menu.branch.isRemote && sameLocalAsCurrent)) && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null)
                void (async () => {
                  echoTerm(`\r\n\x1b[36m$ git fetch --all --prune\x1b[0m\r\n`)
                  try {
                    const msg = await invoke<string>('git_fetch', {
                      path: selected.path,
                    })
                    echoTerm(`\x1b[32m${msg}\x1b[0m\r\n`)
                    await refreshGit()
                  } catch (e) {
                    echoTerm(`\x1b[31m${String(e)}\x1b[0m\r\n`)
                  }
                })()
              }}
            >
              {t('git.ctx.fetch')}
            </button>
          )}
          {!sameLocalAsCurrent && git?.current && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const ref = menu.branch.name
                setMenu(null)
                runGit(`git merge ${JSON.stringify(ref)}`)
              }}
            >
              {t('git.ctx.mergeInto', { name: git.current })}
            </button>
          )}
          {!menu.branch.isRemote && (
            <button
              type="button"
              role="menuitem"
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
            role="menuitem"
            onClick={() => {
              runGit('git status')
              setMenu(null)
            }}
          >
            {t('git.ctx.status')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              runGit('git log --oneline -20')
              setMenu(null)
            }}
          >
            {t('git.ctx.log')}
          </button>
        </ContextMenuPortal>
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
              className="btn primary btn-with-icon"
              disabled={!commitMsg.trim()}
              onClick={doCommit}
            >
              <CheckCircle className="ui-icon" size={14} color="currentColor" aria-hidden />
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
