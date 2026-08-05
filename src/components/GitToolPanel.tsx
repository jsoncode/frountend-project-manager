import {
  Add,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BranchDown,
  CheckCircle,
  Document,
  Pen,
  Refresh,
  Star,
  Trash,
} from 'reicon-react'
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useState, type MouseEvent } from 'react'
import { useI18n } from '../i18n/useI18n'
import { writeHostToTerminal } from '../lib/ptyHost'
import type { BranchItem, GitStatus, MergeStatus } from '../lib/types'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTerminalStore } from '../stores/terminalStore'
import { CommitModal } from './CommitModal'
import { ContextMenuPortal } from './ContextMenuPortal'
import { HistoryChips } from './HistoryChips'
import { MergeConflictModal } from './MergeConflictModal'
import { ModalShell } from './ModalShell'
import { Tooltip } from './Tooltip'

type MenuState = {
  x: number
  y: number
  branch: BranchItem
}

type HistoryMenuState = {
  x: number
  y: number
  value: string
}

type CreateState = {
  from: string
  name: string
}

type DeleteState = {
  branch: BranchItem
  alsoLocal: boolean
}

export function GitToolPanel({ filterQuery = '' }: { filterQuery?: string }) {
  const selected = useProjectStore((s) => s.selected)
  const git = useProjectStore((s) => s.git)
  const gitStatus = useProjectStore((s) => s.gitStatus)
  const mergeStatus = useProjectStore((s) => s.mergeStatus)
  const refreshGit = useProjectStore((s) => s.refreshGit)
  const refreshMergeStatus = useProjectStore((s) => s.refreshMergeStatus)
  const config = useSettingsStore((s) => s.config)
  const setHistoryPinned = useSettingsStore((s) => s.setHistoryPinned)
  const deleteHistory = useSettingsStore((s) => s.deleteHistory)
  const runRaw = useTerminalStore((s) => s.runRaw)
  const ensureRunTarget = useTerminalStore((s) => s.ensureRunTarget)
  const runInSession = useTerminalStore((s) => s.runInSession)
  const waitUntilIdle = useTerminalStore((s) => s.waitUntilIdle)
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null)
  const [dirtyConfirm, setDirtyConfirm] = useState<{
    branch: string
    status: GitStatus
  } | null>(null)
  const [branchBusy, setBranchBusy] = useState(false)
  const [branchError, setBranchError] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [historyMenu, setHistoryMenu] = useState<HistoryMenuState | null>(null)
  const [commitTarget, setCommitTarget] = useState<string | null>(null)
  const [createState, setCreateState] = useState<CreateState | null>(null)
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null)
  const [checking, setChecking] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [mergeModal, setMergeModal] = useState<{
    initial: MergeStatus | null
  } | null>(null)
  const { t } = useI18n()

  const branchHistory =
    selected && config ? (config.branchHistory?.[selected.path] ?? []) : []

  const closeMenu = useCallback(() => setMenu(null), [])
  const closeHistoryMenu = useCallback(() => setHistoryMenu(null), [])

  /** Set of branch names that are favorited (new store + legacy pinned items). */
  const favNames = new Set<string>([
    ...(selected && config ? (config.branchFavorites?.[selected.path] ?? []) : []),
    ...branchHistory.filter((h) => h.pinned).map((h) => h.value),
  ])

  if (!selected) {
    return <div className="muted">{t('tool.needProject')}</div>
  }

  const runGit = (command: string) => {
    void runRaw(selected.path, selected.folderName, command)
  }

  /** Run a git command in the real PTY (native colors) and wait for the prompt. */
  const runGitInTerm = async (command: string) => {
    const id = ensureRunTarget(selected.path, selected.folderName)
    await runInSession(id, selected.path, command)
    await waitUntilIdle(id)
  }

  const echoTerm = (text: string) => {
    const id = ensureRunTarget(selected.path, selected.folderName, {
      allowBusy: true,
    })
    writeHostToTerminal(id, text)
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

  const isFav = (branchName: string) => {
    if (favNames.has(branchName)) return true
    return favNames.has(localName(branchName))
  }

  const isBranchNameTaken = (name: string) => {
    const n = name.trim()
    if (!n) return false
    return (git?.branches ?? []).some((b) => localName(b.name) === n)
  }

  const pullBranch = async (branch: BranchItem) => {
    const name = localName(branch.name)
    setPulling(true)
    try {
      const isCurrent =
        !!git?.current &&
        (git.current === name ||
          git.current === branch.name ||
          localName(git.current) === name)
      // Real shell git — keeps native color / progress. Do not echo captured text.
      const command = isCurrent
        ? 'git pull --ff-only --prune; if (-not $?) { git pull --prune }'
        : `git fetch origin ${JSON.stringify(`${name}:${name}`)}`
      await runGitInTerm(command)
      await refreshGit()
      const status = await invoke<MergeStatus>('git_merge_status', {
        path: selected.path,
      }).catch(() => null)
      if (status && (status.inProgress || status.conflictCount > 0)) {
        setMergeModal({ initial: status })
      }
    } catch (e) {
      echoTerm(`\r\n\x1b[31m${String(e)}\x1b[0m\r\n`)
    } finally {
      setPulling(false)
    }
  }

  const startMerge = async (ref: string) => {
    try {
      await runGitInTerm(
        `git merge --no-commit --no-ff ${JSON.stringify(ref)}`,
      )
      await refreshGit()
      const status = await invoke<MergeStatus>('git_merge_status', {
        path: selected.path,
      }).catch(() => null)
      if (status && (status.inProgress || status.conflictCount > 0)) {
        setMergeModal({ initial: status })
      }
    } catch (e) {
      echoTerm(`\r\n\x1b[31m${String(e)}\x1b[0m\r\n`)
      await refreshMergeStatus().catch(() => undefined)
    }
  }

  const abortMergeFromMenu = async () => {
    if (!window.confirm(t('merge.abortConfirm'))) return
    try {
      await runGitInTerm('git merge --abort')
      await refreshGit()
    } catch (e) {
      echoTerm(`\r\n\x1b[31m${String(e)}\x1b[0m\r\n`)
    }
  }

  const onContext = (e: MouseEvent, branch: BranchItem) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, branch })
  }

  const doCreateBranch = async () => {
    if (!createState || !createState.name.trim() || !selected) return
    const name = createState.name.trim()
    if (isBranchNameTaken(name)) {
      setBranchError(t('git.branchNameTaken', { name }))
      return
    }
    setBranchBusy(true)
    setBranchError(null)
    const from = createState.from
    echoTerm(
      `\r\n\x1b[36m$ git switch -c ${name} ← ${from} && git push -u origin ${name}\x1b[0m\r\n`,
    )
    try {
      const msg = await invoke<string>('git_create_branch', {
        path: selected.path,
        name,
        from,
      })
      echoTerm(`\x1b[32m${msg}\x1b[0m\r\n`)
      setCreateState(null)
      await refreshGit()
    } catch (e) {
      const err = String(e)
      setBranchError(err)
      echoTerm(`\x1b[31m${err}\x1b[0m\r\n`)
      await refreshGit().catch(() => undefined)
      // Already switched (or created) — close so the user isn't stuck retrying create.
      if (err.includes('已切换') || err.includes('已创建')) {
        setCreateState(null)
      }
    } finally {
      setBranchBusy(false)
    }
  }

  const doDeleteBranch = async () => {
    if (!deleteState) return
    setBranchBusy(true)
    setBranchError(null)
    const { branch, alsoLocal } = deleteState
    const label = branch.isRemote
      ? `origin/${localName(branch.name)}`
      : localName(branch.name)
    echoTerm(`\r\n\x1b[36m$ git delete ${label}\x1b[0m\r\n`)
    try {
      const msg = await invoke<string>('git_delete_branch', {
        path: selected.path,
        branch: branch.name,
        isRemote: branch.isRemote,
        alsoLocal: branch.isRemote ? alsoLocal : false,
      })
      echoTerm(`\x1b[32m${msg}\x1b[0m\r\n`)
      setDeleteState(null)
      await refreshGit()
    } catch (e) {
      const err = String(e)
      setBranchError(err)
      echoTerm(`\x1b[31m${err}\x1b[0m\r\n`)
    } finally {
      setBranchBusy(false)
    }
  }

  const isMenuCurrent =
    !!menu &&
    !!git?.current &&
    (git.current === menu.branch.name ||
      (!menu.branch.isRemote && git.current === localName(menu.branch.name)))

  const sameLocalAsCurrent =
    !!menu && !!git?.current && localName(menu.branch.name) === git.current

  const branches = git?.branches ?? []
  const q = filterQuery.trim().toLowerCase()
  const match = (text: string) => !q || text.toLowerCase().includes(q)
  const localBranches = branches.filter((b) => !b.isRemote && match(b.name))
  const remoteBranches = branches.filter((b) => b.isRemote && match(b.name))
  const filteredBranchHistory = [...branchHistory]
    .filter((h) => match(h.value))
    .sort((a, b) => a.value.localeCompare(b.value, undefined, { sensitivity: 'base' }))
  const createNameTaken = Boolean(
    createState?.name.trim() && isBranchNameTaken(createState.name),
  )

  const handleBranchSwitch = async (branchName: string) => {
    if (switchingBranch || !selected) return
    setSwitchingBranch(branchName)
    try {
      const s = await invoke<GitStatus>('git_status', {
        path: selected.path,
      })
      if (s.clean) {
        await invoke<string>('git_checkout', {
          path: selected.path,
          branch: branchName,
        })
        await useSettingsStore
          .getState()
          .touchBranchHistory(selected.path, branchName)
        await refreshGit()
      } else {
        setDirtyConfirm({ branch: branchName, status: s })
      }
    } catch (e) {
      echoTerm(`\r\n\x1b[31m${String(e)}\x1b[0m\r\n`)
    } finally {
      setSwitchingBranch(null)
    }
  }

  const doDirtySwitch = async () => {
    if (!dirtyConfirm || !selected) return
    setSwitchingBranch(dirtyConfirm.branch)
    try {
      await invoke<string>('git_checkout', {
        path: selected.path,
        branch: dirtyConfirm.branch,
      })
      await useSettingsStore
        .getState()
        .touchBranchHistory(selected.path, dirtyConfirm.branch)
      await refreshGit()
    } catch (e) {
      echoTerm(`\r\n\x1b[31m${String(e)}\x1b[0m\r\n`)
    } finally {
      setSwitchingBranch(null)
      setDirtyConfirm(null)
    }
  }

  const changedFilesCount = gitStatus?.entries.length ?? 0

  const renderBranch = (b: BranchItem) => {
    const isCurrent = !b.isRemote && git?.current === b.name
    const isSwitching = switchingBranch === b.name
    const isDisabled = !!switchingBranch && !isSwitching
    const fav = isFav(b.name)
    return (
      <Tooltip
        key={b.name}
        title={
          isSwitching
            ? t('branch.switching')
            : isCurrent
              ? t('git.current')
              : `${t('git.dblclick')} · ${t('git.contextHint')}`
        }
      >
        <div
          className={`branch-item ${isCurrent ? 'current' : ''} ${isSwitching ? 'switching' : ''} ${isDisabled ? 'disabled' : 'clickable'} ${fav ? 'favorited' : ''}`}
          onDoubleClick={() => {
            if (!isCurrent && !isDisabled) void handleBranchSwitch(b.name)
          }}
          onContextMenu={(e) => {
            if (!isDisabled) onContext(e, b)
          }}
        >
          <span className="branch-mark" aria-hidden>
            {isSwitching ? (
              <Refresh
                className="ui-icon is-spinning"
                size={12}
                color="currentColor"
              />
            ) : fav ? (
              <Star
                size={12}
                color="currentColor"
                weight="Filled"
              />
            ) : (
              <BranchDown
                size={12}
                color="currentColor"
                weight={isCurrent ? 'Filled' : 'Outline'}
              />
            )}
          </span>
          <span className="branch-name">{b.name}</span>
          {isCurrent && changedFilesCount > 0 && (
            <Tooltip title={t('git.changedFilesHint', { n: changedFilesCount })}>
              <span className="branch-badge changed">
                <ArrowUp className="inline-icon" size={10} color="currentColor" aria-hidden />
                {changedFilesCount}
              </span>
            </Tooltip>
          )}
          {isCurrent && mergeStatus?.inProgress && (
            <Tooltip title={t('git.ctx.continueMerge')}>
              <span
                className="branch-badge merging"
                onClick={(e) => {
                  e.stopPropagation()
                  setMergeModal({ initial: mergeStatus })
                }}
              >
                {t('git.mergingBadge')}
              </span>
            </Tooltip>
          )}
          {b.behind > 0 && (
            <Tooltip title={t('git.behindHint', { n: b.behind })}>
              <span className="branch-badge behind">
                <ArrowDown className="inline-icon" size={10} color="currentColor" aria-hidden />
                {b.behind}
              </span>
            </Tooltip>
          )}
          {b.ahead > 0 && (
            <Tooltip title={t('git.aheadHint', { n: b.ahead })}>
              <span className="branch-badge ahead">
                <ArrowUp className="inline-icon" size={10} color="currentColor" aria-hidden />
                {b.ahead}
              </span>
            </Tooltip>
          )}
        </div>
      </Tooltip>
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
      <HistoryChips
        title={t('git.history')}
        items={filteredBranchHistory}
        emptyText={q ? t('actionBar.noMatch') : t('git.historyEmpty')}
        currentValue={git?.current ?? undefined}
        onDoubleClick={(branch) => {
          if (git?.current !== branch) void handleBranchSwitch(branch)
        }}
        onContext={(e, value) => {
          e.preventDefault()
          e.stopPropagation()
          setHistoryMenu({ x: e.clientX, y: e.clientY, value })
        }}
      />
      {!git && <div className="muted">{t('git.notRepo')}</div>}
      {git && (
        <>
          <div className="pane-sub" style={{ marginTop: 10 }}>
            {t('git.localBranches')}
          </div>
          <div className="branch-list">
            {localBranches.length === 0 ? (
              <div className="muted">
                {q ? t('actionBar.noMatch') : t('git.branchesEmpty')}
              </div>
            ) : (
              localBranches.map(renderBranch)
            )}
          </div>
          <div className="pane-sub" style={{ marginTop: 10 }}>
            {t('git.remoteBranches')}
          </div>
          <div className="branch-list">
            {remoteBranches.length === 0 ? (
              <div className="muted">
                {q ? t('actionBar.noMatch') : t('git.branchesEmpty')}
              </div>
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
                setMenu(null)
                void handleBranchSwitch(menu.branch.name)
              }}
            >
              <ArrowRight size={14} color="currentColor" />
              {t('git.ctx.checkout')}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setCreateState({
                from: menu.branch.name,
                name: localName(menu.branch.name),
              })
              setBranchError(null)
              setMenu(null)
            }}
          >
            <Add size={14} color="currentColor" />
            {t('git.ctx.newBranchFrom', { name: localName(menu.branch.name) })}
          </button>
          <div className="branch-menu-sep" />
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
            <ArrowDown size={14} color="currentColor" />
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
              <ArrowUp size={14} color="currentColor" />
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
                  try {
                    await runGitInTerm('git fetch --all --prune')
                    await refreshGit()
                  } catch (e) {
                    echoTerm(`\r\n\x1b[31m${String(e)}\x1b[0m\r\n`)
                  }
                })()
              }}
            >
              <Refresh size={14} color="currentColor" />
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
                void startMerge(ref)
              }}
            >
              <BranchDown size={14} color="currentColor" />
              {t('git.ctx.mergeInto', { name: git.current })}
            </button>
          )}
          {mergeStatus?.inProgress && isMenuCurrent && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  setMergeModal({ initial: mergeStatus })
                }}
              >
                {t('git.ctx.continueMerge')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  void abortMergeFromMenu()
                }}
              >
                {t('git.ctx.abortMerge')}
              </button>
            </>
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
              <Pen size={14} color="currentColor" />
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
            <CheckCircle size={14} color="currentColor" />
            {t('git.ctx.status')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const branch = menu.branch.name
              runGit(`git log --format="%h %s (%ar)" -10 ${branch}`)
              setMenu(null)
            }}
          >
            <Document size={14} color="currentColor" />
            {t('git.ctx.log')}
          </button>
          <div className="branch-menu-sep" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard
                .writeText(menu.branch.name)
                .catch(() => undefined)
              setMenu(null)
            }}
          >
            <Document size={14} color="currentColor" />
            {t('git.ctx.copyName')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="favorite"
            onClick={() => {
              const name = localName(menu.branch.name)
              const isCurrentlyFav = favNames.has(name) || favNames.has(menu.branch.name)
              void setHistoryPinned(selected.path, 'branch', name, !isCurrentlyFav)
              setMenu(null)
            }}
          >
            <Star size={14} color="currentColor" weight={isFav(menu.branch.name) ? 'Filled' : 'Outline'} />
            {isFav(menu.branch.name) ? t('git.ctx.unfavorite') : t('git.ctx.favorite')}
          </button>
          {!isMenuCurrent && (
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                setDeleteState({
                  branch: menu.branch,
                  alsoLocal: false,
                })
                setBranchError(null)
                setMenu(null)
              }}
            >
              <Trash size={14} color="currentColor" />
              {t('git.ctx.deleteBranch')}
            </button>
          )}
        </ContextMenuPortal>
      )}

      {historyMenu && (
        <ContextMenuPortal
          x={historyMenu.x}
          y={historyMenu.y}
          onClose={closeHistoryMenu}
        >
          {git?.current !== historyMenu.value && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void handleBranchSwitch(historyMenu.value)
                setHistoryMenu(null)
              }}
            >
              <ArrowRight size={14} color="currentColor" />
              {t('git.ctx.checkout')}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const isCurrentlyFav = favNames.has(historyMenu.value)
              void setHistoryPinned(selected.path, 'branch', historyMenu.value, !isCurrentlyFav)
              setHistoryMenu(null)
            }}
          >
            <Star size={14} color="currentColor" weight={favNames.has(historyMenu.value) ? 'Filled' : 'Outline'} />
            {favNames.has(historyMenu.value)
              ? t('git.ctx.unfavorite')
              : t('git.ctx.favorite')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard
                .writeText(historyMenu.value)
                .catch(() => undefined)
              setHistoryMenu(null)
            }}
          >
            <Document size={14} color="currentColor" />
            {t('git.ctx.copyName')}
          </button>
          <div className="branch-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              void deleteHistory(selected.path, 'branch', historyMenu.value)
              setHistoryMenu(null)
            }}
          >
            <Trash size={14} color="currentColor" />
            {t('history.delete')}
          </button>
        </ContextMenuPortal>
      )}

      {commitTarget && (
        <CommitModal
          projectPath={selected.path}
          projectName={selected.folderName}
          branch={commitTarget}
          showPush
          onClose={() => setCommitTarget(null)}
          onDone={() => {
            setCommitTarget(null)
            void refreshGit()
          }}
        />
      )}

      {createState && (
        <ModalShell
          title={t('git.newBranchTitle')}
          onClose={() => setCreateState(null)}
          footer={
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setCreateState(null)}
                disabled={branchBusy}
              >
                {t('branch.cancel')}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={
                  branchBusy ||
                  !createState.name.trim() ||
                  createNameTaken
                }
                onClick={() => void doCreateBranch()}
              >
                {branchBusy ? t('git.creatingBranch') : t('git.ctx.newBranch')}
              </button>
            </div>
          }
        >
          <p className="muted">
            {t('git.newBranchHint', { name: createState.from })}
          </p>
          <input
            className="input-block"
            value={createState.name}
            onChange={(e) => {
              setBranchError(null)
              setCreateState((s) => (s ? { ...s, name: e.target.value } : s))
            }}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !createNameTaken && createState.name.trim()) {
                void doCreateBranch()
              }
            }}
            placeholder={t('git.newBranchPlaceholder')}
            autoFocus
          />
          {createNameTaken && (
            <div className="status-banner dirty" style={{ marginTop: 10 }}>
              {t('git.branchNameTaken', { name: createState.name.trim() })}
            </div>
          )}
          {branchError && !createNameTaken && (
            <div className="status-banner dirty" style={{ marginTop: 10 }}>
              {branchError}
            </div>
          )}
        </ModalShell>
      )}

      {deleteState && (
        <ModalShell
          title={t('git.deleteBranchTitle')}
          onClose={() => setDeleteState(null)}
          closeOnEsc={false}
          footer={
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setDeleteState(null)}
                disabled={branchBusy}
              >
                {t('branch.cancel')}
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={branchBusy}
                onClick={() => void doDeleteBranch()}
              >
                {branchBusy ? t('git.deletingBranch') : t('git.ctx.deleteBranch')}
              </button>
            </div>
          }
        >
          <p className="muted">
            {deleteState.branch.isRemote
              ? t('git.deleteRemoteConfirm', {
                  name: localName(deleteState.branch.name),
                })
              : t('git.deleteLocalConfirm', {
                  name: localName(deleteState.branch.name),
                })}
          </p>
          {deleteState.branch.isRemote && (
            <label className="checkbox-row" style={{ marginTop: 10 }}>
              <input
                type="checkbox"
                checked={deleteState.alsoLocal}
                onChange={(e) =>
                  setDeleteState((s) =>
                    s ? { ...s, alsoLocal: e.target.checked } : s,
                  )
                }
              />
              <span>{t('git.deleteAlsoLocal')}</span>
            </label>
          )}
          {branchError && (
            <div className="status-banner dirty" style={{ marginTop: 10 }}>
              {branchError}
            </div>
          )}
        </ModalShell>
      )}

      {dirtyConfirm && (
        <ModalShell
          title={t('branch.confirmTitle')}
          onClose={() => setDirtyConfirm(null)}
          closeOnEsc={false}
          className="branch-modal"
          footer={
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setDirtyConfirm(null)}
                disabled={!!switchingBranch}
              >
                {t('branch.cancel')}
              </button>
              <button
                type="button"
                className="btn primary btn-with-icon"
                disabled={!!switchingBranch}
                onClick={() => void doDirtySwitch()}
              >
                <CheckCircle
                  className="ui-icon"
                  size={14}
                  color="currentColor"
                  aria-hidden
                />
                {switchingBranch
                  ? t('branch.switching')
                  : t('branch.confirm')}
              </button>
            </div>
          }
        >
          <p className="branch-switch-path">
            <span className="muted">{t('branch.from')}</span>{' '}
            <strong>{dirtyConfirm.status.current ?? '—'}</strong>{' '}
            <span className="muted inline-icon" aria-hidden>
              <ArrowRight size={14} color="currentColor" />
            </span>{' '}
            <strong className="cyan-text">{dirtyConfirm.branch}</strong>
          </p>
          <div className="status-banner dirty">
            <div className="status-title">
              {t('branch.dirtyTitle', {
                count: dirtyConfirm.status.entries.length,
              })}
            </div>
            <div className="muted" style={{ marginBottom: 8 }}>
              {t('branch.dirtyDesc')}
            </div>
            <div className="dirty-list">
              {dirtyConfirm.status.entries.map((e) => (
                <div
                  key={`${e.code}-${e.path}`}
                  className="dirty-item"
                >
                  <span className="dirty-code">{e.label}</span>
                  <span className="dirty-path">{e.path}</span>
                </div>
              ))}
            </div>
          </div>
        </ModalShell>
      )}

      {mergeModal && (
        <MergeConflictModal
          projectPath={selected.path}
          initial={mergeModal.initial}
          onClose={() => setMergeModal(null)}
          onDone={() => {
            void refreshGit()
          }}
        />
      )}
    </>
  )
}
