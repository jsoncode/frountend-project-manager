import type { MouseEvent } from 'react'
import type { HistoryItem } from '../lib/types'
import { useI18n } from '../i18n/useI18n'
import { Tooltip } from './Tooltip'

/** Pad number with leading zero. */
const pad = (n: number) => String(n).padStart(2, '0')

/** Format timestamp for display: today→HH:mm, this year→M/D, older→YYYY/M/D. */
function formatRelativeDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.getFullYear() === now.getFullYear()) {
    if (
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    ) {
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

/** Format timestamp as full datetime for tooltip. */
function formatFullDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

type Props = {
  title: string
  items: HistoryItem[]
  emptyText?: string
  /** Highlight the chip matching this value as "current". */
  currentValue?: string
  onRun?: (value: string) => void
  onDoubleClick?: (value: string) => void
  onContext?: (e: MouseEvent, value: string) => void
}

export function HistoryChips({
  title,
  items,
  emptyText,
  currentValue,
  onRun,
  onDoubleClick,
  onContext,
}: Props) {
  const { t } = useI18n()
  const pinned = items.filter((i) => i.pinned)
  const recent = items.filter((i) => !i.pinned)

  return (
    <div className="history-block">
      <div className="pane-sub">{title}</div>
      {items.length === 0 && (
        <div className="muted">{emptyText ?? t('history.empty')}</div>
      )}
      {pinned.length > 0 && (
        <>
          <div className="history-label">{t('history.frequent')}</div>
          <div className="history-chips">
            {pinned.map((item) => (
              <HistoryChip
                key={`p-${item.value}`}
                item={item}
                isCurrent={item.value === currentValue}
                onRun={onRun}
                onDoubleClick={onDoubleClick}
                onContext={onContext}
              />
            ))}
          </div>
        </>
      )}
      {recent.length > 0 && (
        <>
          <div className="history-label">{t('history.recent')}</div>
          <div className="history-chips">
            {recent.map((item) => (
              <HistoryChip
                key={`r-${item.value}`}
                item={item}
                isCurrent={item.value === currentValue}
                onRun={onRun}
                onDoubleClick={onDoubleClick}
                onContext={onContext}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function HistoryChip({
  item,
  isCurrent,
  onRun,
  onDoubleClick,
  onContext,
}: {
  item: HistoryItem
  isCurrent: boolean
  onRun?: (value: string) => void
  onDoubleClick?: (value: string) => void
  onContext?: (e: MouseEvent, value: string) => void
}) {
  const { t } = useI18n()
  const dateLabel = formatRelativeDate(item.lastUsedAt)
  const fullLabel = formatFullDate(item.lastUsedAt)
  const main = (
    <span className="history-chip-name">{item.value}</span>
  )
  const date = (
    <span className="history-chip-date muted">{dateLabel}</span>
  )
  const handleDoubleClick = () => {
    if (onDoubleClick) onDoubleClick(item.value)
  }
  return (
    <span
      className={`history-chip ${item.pinned ? 'pinned' : ''} ${isCurrent ? 'current' : ''} ${onDoubleClick ? 'dbl-clickable' : ''}`}
      onContextMenu={(e) => onContext?.(e, item.value)}
      onDoubleClick={handleDoubleClick}
    >
      <Tooltip
        title={`${item.value} · ${t('history.usedTimes', { count: item.count })} · ${fullLabel}`}
      >
        {onRun ? (
          <button
            type="button"
            className="history-chip-main"
            onClick={() => onRun(item.value)}
          >
            {main}
            {date}
          </button>
        ) : (
          <span className="history-chip-main">
            {main}
            {date}
          </span>
        )}
      </Tooltip>
    </span>
  )
}
