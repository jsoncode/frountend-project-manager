import { Button, Spin, Table, Tooltip, type TableProps } from 'antd'
import { ArrowDown } from 'reicon-react'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import type { MessageKey } from '../i18n/messages'
import type { GitInfo, PullBranchResult } from '../lib/types'
import { useProjectStore } from '../stores/projectStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { ModalShell } from './ModalShell'

type RowStatus =
  | 'pending'
  | 'running'
  | 'updated'
  | 'uptodate'
  | 'conflicts'
  | 'error'

type UpdateRow = {
  key: string
  projectPath: string
  folderName: string
  branch: string
  behind: number
  status: RowStatus
  message?: string
}

type Props = {
  workspace: string
  onClose: () => void
}

/** Map a backend branch status to a row status. */
function toRowStatus(status: string): RowStatus {
  switch (status) {
    case 'updated':
      return 'updated'
    case 'uptodate':
      return 'uptodate'
    case 'conflicts':
      return 'conflicts'
    default:
      return 'error'
  }
}

const STATUS_KEYS: Record<RowStatus, MessageKey> = {
  pending: 'ws.updateStatusPending',
  running: 'ws.updateStatusRunning',
  updated: 'ws.updateStatusUpdated',
  uptodate: 'ws.updateStatusUptodate',
  conflicts: 'ws.updateStatusConflict',
  error: 'ws.updateStatusError',
}

/** A hung `git_pull_all` must not lock the modal forever (audit P2-11). */
const RUN_TIMEOUT_MS = 120_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`timeout:${ms}`)),
      ms,
    )
    p.then(
      (v) => {
        window.clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        window.clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/**
 * Workspace-level "update all projects" flow:
 * 1. Scan every project under the workspace (fetch-first) and collect the
 *    项目-分支 pairs that have pending commits (behind > 0).
 * 2. Show them in a confirmation table.
 * 3. On confirm, update one project at a time via `git_pull_all` (which
 *    updates every pending branch of that project) and echo the per-branch
 *    outcome back into the table.
 */
export function UpdateAllProjectsModal({ workspace, onClose }: Props) {
  const { t } = useI18n()
  const [rows, setRows] = useState<UpdateRow[]>([])
  const [scanning, setScanning] = useState(true)
  const [scanDone, setScanDone] = useState(0)
  const [scanTotal, setScanTotal] = useState(0)
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)
  const [projectsDone, setProjectsDone] = useState(0)
  const [projectsTotal, setProjectsTotal] = useState(0)
  // Ref so onClose guards / async loops never read stale state.
  const runningRef = useRef(false)

  // ── Phase 1: scan for pending 项目-分支 pairs ──
  useEffect(() => {
    let alive = true
    void (async () => {
      const ws = useWorkspaceStore.getState()
      const projects = ws.projectCache[workspace] ?? []
      setScanTotal(projects.length)
      const found: UpdateRow[] = []
      for (let i = 0; i < projects.length; i++) {
        if (!alive) return
        const p = projects[i]
        // Fetch remotes first (best effort) so behind counts reflect the
        // latest remote tips; offline repos simply keep their last refs.
        await invoke('git_fetch', { path: p.path }).catch(() => {})
        let info: GitInfo | null = null
        try {
          info = await invoke<GitInfo | null>('git_branches', { path: p.path })
        } catch {
          /* not a git repo — nothing to update */
        }
        if (info?.branches) {
          for (const b of info.branches) {
            // Remote entries mirror their local counterpart; only local
            // branches actually get updated.
            if (b.isRemote) continue
            if (b.behind <= 0) continue
            found.push({
              key: `${p.path}|${b.name}`,
              projectPath: p.path,
              folderName: p.folderName,
              branch: b.name,
              behind: b.behind,
              status: 'pending',
            })
          }
        }
        if (alive) setScanDone(i + 1)
      }
      if (alive) {
        setRows(found)
        setScanning(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [workspace])

  // ── Phase 2: run the updates, one project at a time ──
  const runUpdates = async () => {
    if (runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setFinished(false)
    // Unique project paths, preserving row order.
    const projects = [...new Set(rows.map((r) => r.projectPath))]
    setProjectsTotal(projects.length)
    setProjectsDone(0)

    let done = 0
    for (const projectPath of projects) {
      if (!runningRef.current) break
      setRows((prev) =>
        prev.map((r) =>
          r.projectPath === projectPath
            ? { ...r, status: 'running', message: undefined }
            : r,
        ),
      )
      try {
        const res = await withTimeout(
          invoke<PullBranchResult>('git_pull_all', {
            path: projectPath,
          }),
          RUN_TIMEOUT_MS,
        )
        const byName = new Map(
          (res.branches ?? []).map((b) => [b.name, b]),
        )
        setRows((prev) =>
          prev.map((r) => {
            if (r.projectPath !== projectPath) return r
            const detail = byName.get(r.branch)
            if (detail) {
              return {
                ...r,
                status: toRowStatus(detail.status),
                message: detail.message,
              }
            }
            // Backend without per-branch detail: apply the overall status.
            return {
              ...r,
              status:
                res.status === 'conflicts'
                  ? 'conflicts'
                  : res.status === 'updated'
                    ? 'updated'
                    : 'uptodate',
              message:
                res.status === 'conflicts' || res.status === 'error'
                  ? res.message
                  : undefined,
            }
          }),
        )
      } catch (e) {
        const raw = String(e)
        const msg = raw.startsWith('timeout:')
          ? t('ws.updateAllTimeout')
          : raw
        setRows((prev) =>
          prev.map((r) =>
            r.projectPath === projectPath
              ? { ...r, status: 'error', message: msg }
              : r,
          ),
        )
      }
      done += 1
      setProjectsDone(done)
    }

    runningRef.current = false
    setRunning(false)
    setFinished(true)
    setProjectsDone(done)

    // Refresh the git state of every updated project (skip the network —
    // the pulls just moved the refs) so Explorer badges and the branch panel
    // reflect the fresh behind counts.
    for (const projectPath of projects) {
      try {
        await useProjectStore
          .getState()
          .refreshProjectGitStatus(projectPath, { fetch: false })
      } catch {
        /* ignore refresh errors */
      }
    }
  }

  const close = () => {
    // Never close mid-update: the backend loop must finish the current
    // project's pull before the modal (and its row statuses) disappear.
    // Use the explicit cancel button to stop after the current project.
    if (runningRef.current) return
    onClose()
  }

  /** Stop the update loop after the current project (modal stays closable). */
  const cancelUpdates = () => {
    runningRef.current = false
  }

  const summary = useMemo(() => {
    if (!finished) return null
    let ok = 0
    let fail = 0
    let conflict = 0
    for (const r of rows) {
      if (r.status === 'updated' || r.status === 'uptodate') ok += 1
      else if (r.status === 'error') fail += 1
      else if (r.status === 'conflicts') conflict += 1
    }
    return { ok, fail, conflict }
  }, [finished, rows])

  const columns: TableProps<UpdateRow>['columns'] = [
    {
      title: t('ws.updateAllColProject'),
      dataIndex: 'folderName',
      key: 'project',
      width: 220,
      ellipsis: true,
      render: (name: string, rec) => (
        <Tooltip title={rec.projectPath}>
          <span className="update-all-project user-select-text">{name}</span>
        </Tooltip>
      ),
    },
    {
      title: t('ws.updateAllColBranch'),
      dataIndex: 'branch',
      key: 'branch',
      width: 180,
      ellipsis: true,
      render: (branch: string, rec) => (
        <Tooltip title={rec.message}>
          <span className="update-all-branch mono">{branch}</span>
        </Tooltip>
      ),
    },
    {
      title: t('ws.updateAllColPending'),
      dataIndex: 'behind',
      key: 'behind',
      width: 90,
      render: (behind: number) => (
        <span className="proj-status-badge proj-status-behind">
          <ArrowDown className="ui-icon" size={10} color="currentColor" aria-hidden />
          {behind}
        </span>
      ),
    },
    {
      title: t('ws.updateAllColStatus'),
      dataIndex: 'status',
      key: 'status',
      width: 150,
      render: (status: RowStatus, rec) => (
        <Tooltip title={rec.message}>
          <span className={`update-all-status update-all-status-${status}`}>
            {status === 'running' && <Spin size="small" />}
            {t(STATUS_KEYS[status])}
          </span>
        </Tooltip>
      ),
    },
  ]

  const noRows = !scanning && rows.length === 0

  return (
    <ModalShell
      title={t('ws.updateAllTitle')}
      onClose={close}
      wide
      className="update-all-modal"
      closeOnEsc={!running}
      footer={
        running ? (
          <span className="update-all-running muted">
            <Spin size="small" />
            {t('ws.updateAllRunning', {
              done: projectsDone,
              total: Math.max(projectsTotal, projectsDone),
            })}
            <Button size="small" onClick={cancelUpdates}>
              {t('ws.updateAllCancelRun')}
            </Button>
          </span>
        ) : finished ? (
          <>
            {summary && (
              <span className="update-all-summary">
                {t('ws.updateAllSummary', summary)}
                {summary.conflict > 0 && (
                  <span className="muted update-all-conflict-hint">
                    {' '}
                    {t('ws.updateAllSummaryConflictHint')}
                  </span>
                )}
              </span>
            )}
            <Button type="primary" onClick={onClose}>
              {t('ws.updateAllDone')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>{t('ws.updateAllCancel')}</Button>
            <Button
              danger
              disabled={scanning || noRows}
              onClick={() => void runUpdates()}
            >
              {t('ws.updateAllStart')}
            </Button>
          </>
        )
      }
    >
      <div className="muted update-all-hint">{t('ws.updateAllHint')}</div>
      {scanning ? (
        <div className="git-log-loading">
          <Spin size="small" />
          <span>
            {t('ws.updateAllScanProgress', {
              done: scanDone,
              total: scanTotal,
            })}
          </span>
        </div>
      ) : noRows ? (
        <div className="git-log-loading">{t('ws.updateAllEmpty')}</div>
      ) : (
        <Table<UpdateRow>
          className="git-log-table"
          rowKey="key"
          size="small"
          columns={columns}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: t('ws.updateAllEmpty') }}
          scroll={{ y: 360 }}
        />
      )}
    </ModalShell>
  )
}
