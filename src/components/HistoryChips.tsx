import { Star, Trash } from 'reicon-react'
import type { HistoryItem } from '../lib/types'
import { useI18n } from '../i18n/useI18n'
import { Tooltip } from './Tooltip'

type Props = {
  title: string
  items: HistoryItem[]
  emptyText?: string
  onRun: (value: string) => void
  onTogglePin: (value: string, pinned: boolean) => void
  onDelete: (value: string) => void
}

export function HistoryChips({
  title,
  items,
  emptyText,
  onRun,
  onTogglePin,
  onDelete,
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
                onRun={onRun}
                onTogglePin={onTogglePin}
                onDelete={onDelete}
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
                onRun={onRun}
                onTogglePin={onTogglePin}
                onDelete={onDelete}
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
  onRun,
  onTogglePin,
  onDelete,
}: {
  item: HistoryItem
  onRun: (value: string) => void
  onTogglePin: (value: string, pinned: boolean) => void
  onDelete: (value: string) => void
}) {
  const { t } = useI18n()
  return (
    <span className={`history-chip ${item.pinned ? 'pinned' : ''}`}>
      <Tooltip
        title={`${item.value} · ${t('history.usedTimes', { count: item.count })}`}
      >
        <button
          type="button"
          className="history-chip-main"
          onClick={() => onRun(item.value)}
        >
          {item.value}
        </button>
      </Tooltip>
      <Tooltip title={item.pinned ? t('history.unpin') : t('history.pin')}>
        <button
          type="button"
          className="history-chip-icon"
          onClick={() => onTogglePin(item.value, !item.pinned)}
        >
          <Star
            className="ui-icon"
            size={12}
            color="currentColor"
            weight={item.pinned ? 'Filled' : 'Outline'}
            aria-hidden
          />
        </button>
      </Tooltip>
      <Tooltip title={t('history.delete')}>
        <button
          type="button"
          className="history-chip-icon danger"
          onClick={() => onDelete(item.value)}
        >
          <Trash className="ui-icon" size={12} color="currentColor" aria-hidden />
        </button>
      </Tooltip>
    </span>
  )
}
