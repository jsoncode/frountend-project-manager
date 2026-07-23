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

  if (!selected) return null

  const runGit = (command: string) => {
    void runRaw(selected.path, selected.folderName, command)
  }

  const echoTerm = (text: string) => {
    const id = ensureRunTarget(selected.path, selected.folderName)
    writeToTerminal(id, text)
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
    const cmds =
      git?.current === branch || branch.startsWith('origin/')
        ? `git add -A && git commit -m ${quoted}`
        : `git switch ${JSON.stringify(localName(branch))} && git add -A && git commit -m ${quoted}`
    runGit(cmds)
  }

  return (
    <>
      <div className="git-toolbar">
        <button
          type="button"
          className="btn btn-sm primary"
          disabled={checking || pulling}
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
        <ContextMenuPortal x={menu.x} y={menu.y} onClose={closeMenu}>
          {!menu.branch.isRemote && git?.current !== menu.branch.name && (
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
            {git?.current === menu.branch.name ||
            (!menu.branch.isRemote &&
              git?.current === localName(menu.branch.name))
              ? t('git.ctx.pull')
              : t('git.ctx.pullOther')}
          </button>
          {!menu.branch.isRemote && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const name = localName(menu.branch.name)
                const isCurrent = git?.current === menu.branch.name
                runGit(
                  isCurrent
                    ? 'git push'
                    : `git push -u origin ${JSON.stringify(name)}:${name}`,
                )
                setMenu(null)
              }}
            >
              {t('git.ctx.push')}
            </button>
          )}
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
