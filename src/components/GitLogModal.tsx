import { CheckOutlined, CopyOutlined } from '@ant-design/icons'
import { Button, Spin, Table, Tooltip, type TableProps } from 'antd'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import type { GitLogEntry } from '../lib/types'
import { ModalShell } from './ModalShell'

/** How many commits the log viewer requests from the backend. */
const LOG_LIMIT = 200

type Props = {
  projectPath: string
  projectName: string
  branch: string
  onClose: () => void
}

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Locale-aware relative time, e.g. "3 hours ago" / "3 小时前". */
function relativeTime(iso: string, locale: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const rtf = new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    numeric: 'auto',
  })
  const diffMs = d.getTime() - Date.now()
  const absSec = Math.abs(Math.round(diffMs / 1000))
  if (absSec < 60) return rtf.format(Math.round(diffMs / 1000), 'second')
  const absMin = Math.abs(Math.round(diffMs / 60_000))
  if (absMin < 60) return rtf.format(Math.round(diffMs / 60_000), 'minute')
  const absHour = Math.abs(Math.round(diffMs / 3_600_000))
  if (absHour < 24) return rtf.format(Math.round(diffMs / 3_600_000), 'hour')
  const absDay = Math.abs(Math.round(diffMs / 86_400_000))
  if (absDay < 30) return rtf.format(Math.round(diffMs / 86_400_000), 'day')
  return formatDate(iso, locale)
}

export function GitLogModal({ projectPath, branch, onClose }: Props) {
  const { t, locale } = useI18n()
  const [entries, setEntries] = useState<GitLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Key of the last copied item ("hash:<hash>" or "all") for check feedback.
  const [copied, setCopied] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const copiedTimer = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    setEntries(null)
    setError(null)
    invoke<GitLogEntry[]>('git_log', {
      path: projectPath,
      branch,
      limit: LOG_LIMIT,
    })
      .then((list) => {
        if (alive) setEntries(list)
      })
      .catch((e: unknown) => {
        if (alive) setError(String(e))
      })
    return () => {
      alive = false
    }
  }, [projectPath, branch, reloadKey])

  useEffect(() => {
    return () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
    }
  }, [])

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => {
        setCopied((c) => (c === key ? null : c))
      }, 1600)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  /** Whole log as plain text, so users can keep 100% of the info. */
  const fullLogText = useMemo(() => {
    if (!entries) return ''
    return entries
      .map((e) => {
        const lines = [
          `${e.shortHash} ${e.subject}`,
          `${t('git.log.author')}: ${e.authorName} <${e.authorEmail}>`,
          `${t('git.log.date')}: ${e.authorDate}`,
        ]
        if (e.refs) lines.push(`${t('git.log.refs')}: ${e.refs}`)
        if (e.parents) lines.push(`${t('git.log.parents')}: ${e.parents}`)
        if (e.body) lines.push('', e.body)
        return lines.join('\n')
      })
      .join('\n\n')
  }, [entries, t])

  const refChips = (refs: string) =>
    refs
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => (
        <span key={r} className="git-log-ref-chip" title={r}>
          {r}
        </span>
      ))

  const columns: TableProps<GitLogEntry>['columns'] = [
    {
      title: t('git.log.hash'),
      dataIndex: 'shortHash',
      key: 'shortHash',
      width: 120,
      render: (_, rec) => {
        const key = `hash:${rec.hash}`
        const isCopied = copied === key
        return (
          <Tooltip title={rec.hash}>
            <button
              type="button"
              className="git-log-hash"
              onClick={(e) => {
                e.stopPropagation()
                void copyText(rec.hash, key)
              }}
            >
              {isCopied ? (
                <CheckOutlined className="git-log-copy-ok" />
              ) : (
                <CopyOutlined className="git-log-copy-icon" />
              )}
              <span>{rec.shortHash}</span>
            </button>
          </Tooltip>
        )
      },
    },
    {
      title: t('git.log.refs'),
      dataIndex: 'refs',
      key: 'refs',
      width: 200,
      render: (refs: string) =>
        refs ? <div className="git-log-refs">{refChips(refs)}</div> : null,
    },
    {
      title: t('git.log.subject'),
      dataIndex: 'subject',
      key: 'subject',
      ellipsis: true,
      render: (subject: string) => (
        <span className="git-log-subject user-select-text" title={subject}>
          {subject}
        </span>
      ),
    },
    {
      title: t('git.log.author'),
      dataIndex: 'authorName',
      key: 'authorName',
      width: 170,
      ellipsis: true,
      render: (name: string, rec) => (
        <Tooltip title={`${name} <${rec.authorEmail}>`}>
          <span className="git-log-author">{name}</span>
        </Tooltip>
      ),
    },
    {
      title: t('git.log.date'),
      dataIndex: 'authorDate',
      key: 'authorDate',
      width: 180,
      render: (date: string) => {
        const rel = relativeTime(date, locale)
        const abs = formatDate(date, locale)
        return (
          <Tooltip title={rel}>
            <span className="git-log-date">{abs}</span>
          </Tooltip>
        )
      },
    },
  ]

  const detailRows = (rec: GitLogEntry) => [
    { label: t('git.log.fullHash'), value: rec.hash, mono: true, copyKey: `hash:${rec.hash}` },
    {
      label: t('git.log.author'),
      value: `${rec.authorName} <${rec.authorEmail}>`,
      mono: false,
    },
    {
      label: t('git.log.authorDate'),
      value: `${formatDate(rec.authorDate, locale)} · ${relativeTime(rec.authorDate, locale)}`,
      mono: false,
    },
    { label: t('git.log.committerDate'), value: formatDate(rec.committerDate, locale), mono: false },
    { label: t('git.log.parents'), value: rec.parents || t('git.log.none'), mono: true },
    { label: t('git.log.body'), value: rec.body || t('git.log.none'), mono: false },
  ]

  const body = entries ? (
    <Table<GitLogEntry>
      className="git-log-table"
      rowKey="hash"
      size="small"
      columns={columns}
      dataSource={entries}
      sticky
      expandRowByClick
      expandable={{
        expandedRowRender: (rec) => (
          <div className="git-log-detail">
            <div className="git-log-detail-grid">
              {detailRows(rec).map((row) => (
                <div className="git-log-detail-row" key={row.label}>
                  <span className="git-log-detail-label">{row.label}</span>
                  <span
                    className={`git-log-detail-value user-select-text${
                      row.mono ? ' mono' : ''
                    }`}
                  >
                    {row.value}
                    {row.copyKey && (
                      <button
                        type="button"
                        className="git-log-copy-btn"
                        title={t('git.log.copyHash')}
                        onClick={() => void copyText(rec.hash, row.copyKey!)}
                      >
                        {copied === row.copyKey ? (
                          <CheckOutlined className="git-log-copy-ok" />
                        ) : (
                          <CopyOutlined className="git-log-copy-icon" />
                        )}
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ),
      }}
      pagination={{
        // NOTE: must be `defaultPageSize` (uncontrolled), NOT `pageSize`.
        // antd v6's usePagination merges the pagination prop OVER the inner
        // state (mergeProps(innerPagination, paginationObj)), so a controlled
        // `pageSize` would always win and the size changer would never change
        // the rendered row count.
        defaultPageSize: 10,
        pageSizeOptions: [10, 20, 50, 100],
        // antd v6 renders the size-changer popup inside the pagination node
        // (`getPopupContainer: node => node.parentNode`); the modal body's
        // `overflow: auto` (plus hidden scrollbars) clips it at the bottom,
        // so the dropdown never appears — "switching size does nothing".
        // Portal the popup to <body>; its z-index (modal 1000 + 50) still
        // stays above the modal, so it remains clickable.
        showSizeChanger: {
          getPopupContainer: () => document.body,
        },
        showTotal: (total) => t('git.log.pageTotal', { total }),
      }}
      locale={{ emptyText: t('git.log.empty') }}
    />
  ) : error ? (
    <div className="status-banner dirty" style={{ marginTop: 4 }}>
      {t('error.gitFailed')}: {error}
      <div style={{ marginTop: 10 }}>
        <Button size="small" onClick={() => setReloadKey((k) => k + 1)}>
          {t('editor.retry')}
        </Button>
      </div>
    </div>
  ) : (
    <div className="git-log-loading">
      <Spin size="small" />
      <span>{t('git.log.loading')}</span>
    </div>
  )

  return (
    <ModalShell
      title={t('git.log.title')}
      onClose={onClose}
      wide
      className="git-log-modal"
      footer={
        <>
          <Button
            disabled={!entries || entries.length === 0}
            onClick={() => void copyText(fullLogText, 'all')}
          >
            {copied === 'all' ? t('git.log.copied') : t('git.log.copyFull')}
          </Button>
          <Button type="primary" onClick={onClose}>
            {t('settings.close')}
          </Button>
        </>
      }
    >
      <div className="muted git-log-hint">
        {entries && entries.length < LOG_LIMIT
          ? t('git.log.total', { branch, n: entries.length })
          : t('git.log.limited', { branch, n: LOG_LIMIT })}
      </div>
      {body}
    </ModalShell>
  )
}
