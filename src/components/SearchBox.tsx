import { DeleteOutlined } from '@ant-design/icons'
import { AutoComplete, Button } from 'antd'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type KeyboardEvent,
} from 'react'
import { useI18n } from '../i18n/useI18n'
import type { HistoryItem } from '../lib/types'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { Tooltip } from './Tooltip'

/** Stable empty ref — never put `?? []` inside a Zustand selector (causes React #185). */
const EMPTY_HISTORY: HistoryItem[] = []

export function SearchBox({ autofocus = false }: { autofocus?: boolean }) {
  const search = useWorkspaceStore((s) => s.search)
  const setSearch = useWorkspaceStore((s) => s.setSearch)
  const history = useSettingsStore((s) => s.config?.searchHistory ?? EMPTY_HISTORY)
  const touchSearchHistory = useSettingsStore((s) => s.touchSearchHistory)
  const deleteHistory = useSettingsStore((s) => s.deleteHistory)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<ComponentRef<typeof AutoComplete>>(null)
  const { t } = useI18n()

  useEffect(() => {
    if (!autofocus) return
    const tmr = window.setTimeout(() => inputRef.current?.focus(), 40)
    return () => window.clearTimeout(tmr)
  }, [autofocus])

  const picks = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = history.map((h) => h.value)
    if (!q) return list.slice(0, 8)
    return list.filter((v) => v.toLowerCase().includes(q)).slice(0, 8)
  }, [history, search])

  const applySearch = (value: string) => {
    setSearch(value.trim())
    setOpen(false)
  }

  const pickHistory = (value: string) => {
    const v = value.trim()
    applySearch(v)
    if (v) void touchSearchHistory(v)
  }

  const clear = () => {
    setSearch('')
    setOpen(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !open && search) {
      e.preventDefault()
      applySearch(search)
      return
    }
    if (e.key === 'Escape' && search && !e.defaultPrevented) {
      e.preventDefault()
      clear()
    }
  }

  const options = useMemo(
    () => [
      ...(picks.length > 0
        ? [
            {
              value: '__search-history-title__',
              disabled: true,
              label: (
                <div className="search-suggest-title muted">
                  {t('top.searchHistory')}
                </div>
              ),
            },
          ]
        : []),
      ...picks.map((item) => ({
        value: item,
        label: (
          <div className="search-suggest-item">
            <span className="search-suggest-pick">{item}</span>
            <Tooltip title={t('top.searchHistoryDel')}>
              <Button
                type="text"
                size="small"
                className="search-suggest-del"
                aria-label={t('top.searchHistoryDel')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation()
                  void deleteHistory('', 'search', item)
                }}
              >
                <DeleteOutlined style={{ fontSize: 12 }} />
              </Button>
            </Tooltip>
          </div>
        ),
      })),
    ],
    [picks, t, deleteHistory],
  )

  return (
    <div className="search-wrap">
      <AutoComplete
        ref={inputRef}
        value={search}
        options={options}
        open={open && picks.length > 0}
        onDropdownVisibleChange={setOpen}
        onChange={(v) => {
          setSearch(v)
        }}
        onSelect={pickHistory}
        onKeyDown={onKeyDown}
        filterOption={false}
        notFoundContent={null}
        allowClear
        onClear={clear}
        placeholder={t('top.search')}
        popupClassName="search-suggest-popup"
        // 弹层宽度自适应内容（默认固定等于输入框宽度，长文案会被截断）
        popupMatchSelectWidth={false}
      />
    </div>
  )
}
