import type { MouseEvent } from 'react'
import type { HistoryItem } from '../lib/types'
import type { MessageKey } from '../i18n/messages'
import { useI18n } from '../i18n/useI18n'
import { Tooltip } from './Tooltip'

/** Pad number with leading zero. */
const pad = (n: number) => String(n).padStart(2, '0')

/** Format timestamp as full datetime for tooltip. */
function formatFullDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Format time portion as HH:mm. */
function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Format timestamp for display using human-readable relative dates. */
function formatRelativeDate(ts: number, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffDay = Math.floor(diffMs / 86400000)

  // Less than 1 minute
  if (diffMin < 1) return t('time.justNow')
  // Less than 1 hour
  if (diffMin < 60) return t('time.minutesAgo', { count: diffMin })
  // Today
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
    const period = d.getHours() < 12 ? 'time.todayMorning' : 'time.todayAfternoon'
    return t(period, { time: formatTime(d) })
  }
  // Yesterday
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate()) {
    return t('time.yesterday', { time: formatTime(d) })
  }
  // 2-6 days ago
  if (diffDay >= 2 && diffDay <= 6) return t('time.daysAgo', { count: diffDay })
  // This year or older — show month/day
  if (d.getFullYear() === now.getFullYear()) {
    return t('time.date', { month: d.getMonth() + 1, day: d.getDate() })
  }
  // Older than this year
  return t('time.fullDate', { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() })
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

  return (
    <div className="history-block">
      <div className="pane-sub">{title}</div>
      {items.length === 0 && (
        <div className="muted">{emptyText ?? t('history.empty')}</div>
      )}
      {items.length > 0 && (
        <div className="history-chips">
          {items.map((item) => (
            <HistoryChip
              key={item.value}
              item={item}
              isCurrent={item.value === currentValue}
              onRun={onRun}
              onDoubleClick={onDoubleClick}
              onContext={onContext}
            />
          ))}
        </div>
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
  const dateLabel = formatRelativeDate(item.lastUsedAt, t)
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
