import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useI18n } from '../i18n/useI18n'
import type { HistoryItem } from '../lib/types'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

/** Stable empty ref — never put `?? []` inside a Zustand selector (causes React #185). */
const EMPTY_HISTORY: HistoryItem[] = []

export function SearchBox() {
  const search = useWorkspaceStore((s) => s.search)
  const setSearch = useWorkspaceStore((s) => s.setSearch)
  const history = useSettingsStore((s) => s.config?.searchHistory ?? EMPTY_HISTORY)
  const touchSearchHistory = useSettingsStore((s) => s.touchSearchHistory)
  const deleteHistory = useSettingsStore((s) => s.deleteHistory)
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const { t } = useI18n()

  const picks = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = history.map((h) => h.value)
    if (!q) return list.slice(0, 8)
    return list.filter((v) => v.toLowerCase().includes(q)).slice(0, 8)
  }, [history, search])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    setHi(0)
  }, [picks, open])

  const applySearch = (value: string) => {
    setSearch(value.trim())
    setOpen(false)
  }

  /** Pick an existing history item — refreshes recency. */
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
    if (e.key === 'ArrowDown' && open && picks.length > 0) {
      e.preventDefault()
      setHi((i) => (i + 1) % picks.length)
      return
    }
    if (e.key === 'ArrowUp' && open && picks.length > 0) {
      e.preventDefault()
      setHi((i) => (i - 1 + picks.length) % picks.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      // 仅回填历史项；纯搜索词不写入历史（历史在点击项目时保存）
      if (open && picks[hi]) pickHistory(picks[hi]!)
      else applySearch(search)
      return
    }
    if (e.key === 'Escape') {
      if (search) {
        e.preventDefault()
        clear()
        return
      }
      setOpen(false)
    }
  }

  return (
    <div className="search-wrap" ref={wrapRef}>
      <input
        className="search"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={t('top.search')}
        autoComplete="off"
      />
      {search.length > 0 && (
        <button
          type="button"
          className="search-clear"
          title={t('top.searchClear')}
          aria-label={t('top.searchClear')}
          onClick={clear}
        >
          ×
        </button>
      )}
      {open && picks.length > 0 && (
        <div className="search-suggest" role="listbox">
          <div className="search-suggest-title muted">{t('top.searchHistory')}</div>
          {picks.map((item, idx) => (
            <div
              key={item}
              className={`search-suggest-item ${idx === hi ? 'active' : ''}`}
              role="option"
              aria-selected={idx === hi}
            >
              <button
                type="button"
                className="search-suggest-pick"
                onMouseEnter={() => setHi(idx)}
                onClick={() => pickHistory(item)}
              >
                {item}
              </button>
              <button
                type="button"
                className="search-suggest-del"
                title={t('top.searchHistoryDel')}
                onClick={(e) => {
                  e.stopPropagation()
                  void deleteHistory('', 'search', item)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
