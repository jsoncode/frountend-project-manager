import { Play, Refresh, Search, Shield, Trash, Tree } from 'reicon-react'
import { useState, type MouseEvent } from 'react'
import type { MessageKey } from '../i18n/messages'
import { useI18n } from '../i18n/useI18n'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTerminalStore } from '../stores/terminalStore'
import { ContextMenuPortal } from './ContextMenuPortal'
import { HistoryChips } from './HistoryChips'
import { Tooltip } from './Tooltip'

type CommonCmd = { key: MessageKey; icon: typeof Play; cmd: (pm: string) => string }

/** Package managers selectable per project in the commands section. */
const PM_NAMES = ['npm', 'pnpm', 'yarn'] as const
type PmName = (typeof PM_NAMES)[number]

const COMMON_COMMANDS: CommonCmd[] = [
  { key: 'cmd.outdated', icon: Search, cmd: (pm) => `${pm} outdated` },
  { key: 'cmd.update', icon: Refresh, cmd: (pm) => `${pm} update` },
  { key: 'cmd.updateLatest', icon: Refresh, cmd: (pm) => `${pm} update --latest` },
  { key: 'cmd.list', icon: Tree, cmd: (pm) => `${pm} list --depth 3` },
  { key: 'cmd.audit', icon: Shield, cmd: (pm) => `${pm} audit` },
  { key: 'cmd.storePrune', icon: Trash, cmd: (pm) => `${pm} store prune` },
]

/** npm/pnpm/yarn scripts — shown inside the action bar. */
export function CommandPanel({ filterQuery = '' }: { filterQuery?: string }) {
  const selected = useProjectStore((s) => s.selected)
  const details = useProjectStore((s) => s.details)
  const runScript = useTerminalStore((s) => s.runScript)
  const runRaw = useTerminalStore((s) => s.runRaw)
  const config = useSettingsStore((s) => s.config)
  const setProjectPm = useSettingsStore((s) => s.setProjectPm)
  const { t } = useI18n()
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; value: string; originalValue: string } | null>(null)

  if (!selected || !details) {
    return <div className="muted">{t('cmd.selectProject')}</div>
  }

  const q = filterQuery.trim().toLowerCase()
  const match = (text: string) => !q || text.toLowerCase().includes(q)

  // Keep package.json scripts key order (do not re-sort).
  const scripts = Object.keys(details.summary.scripts).filter(match)
  // Effective package manager: per-project cached choice, default pnpm.
  const cachedPm = config?.projectPms?.[selected.path]
  const pm: PmName =
    cachedPm === 'npm' || cachedPm === 'yarn' || cachedPm === 'pnpm'
      ? cachedPm
      : 'pnpm'
  // Strip package manager prefix from history items (e.g., "pnpm build" → "build")
  const stripPrefix = (v: string) => v.replace(/^(npm run |pnpm |yarn |bun )/, '')
  const rawHistory = config?.commandHistory?.[selected.path] ?? []
  const history = rawHistory
    .map((h) => ({ ...h, originalValue: h.value, value: stripPrefix(h.value) }))
    .filter((h) => !q || h.value.toLowerCase().includes(q))
    .sort((a, b) => {
      // Pinned first, then alphabetical by name
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return a.value.localeCompare(b.value, undefined, { sensitivity: 'base' })
    })

  return (
    <div className="command-panel-side">
      <HistoryChips
        title={t('cmd.history')}
        items={history}
        emptyText={q ? t('actionBar.noMatch') : t('cmd.historyEmpty')}
        onRun={(cmd) => {
          const full = pm === 'npm' ? `npm run ${cmd}` : `${pm} ${cmd}`
          void useSettingsStore.getState().touchCommandHistory(selected.path, cmd)
          void runRaw(selected.path, selected.folderName, full)
        }}
        onContext={(e: MouseEvent, value: string) => {
          e.preventDefault()
          e.stopPropagation()
          // Find the original stored value (may have pm prefix) for deletion
          const item = rawHistory.find((h) => stripPrefix(h.value) === value)
          setCtxMenu({ x: e.clientX, y: e.clientY, value, originalValue: item?.value ?? value })
        }}
      />

      <div className="pane-sub">
        {t('cmd.title')} · {pm}
      </div>
      <div
        className="pm-switch"
        role="group"
        aria-label={t('cmd.pm')}
        title={t('cmd.pm')}
      >
        {PM_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className={`pm-switch-btn${pm === name ? ' active' : ''}`}
            aria-pressed={pm === name}
            onClick={() => void setProjectPm(selected.path, name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="script-list">
        {scripts.map((name) => (
          <Tooltip key={name} title={details.summary.scripts[name]}>
            <button
              type="button"
              className="script-list-item btn-with-icon"
              onClick={() =>
                void runScript(selected.path, selected.folderName, pm, name)
              }
            >
              <Play className="ui-icon" size={11} color="currentColor" aria-hidden />
              <span className="script-list-name">{name}</span>
            </button>
          </Tooltip>
        ))}
        {scripts.length === 0 && (
          <span className="muted">
            {q ? t('actionBar.noMatch') : t('cmd.noScripts')}
          </span>
        )}
      </div>

      <div className="pane-sub">{t('cmd.common')}</div>
      <div className="script-list">
        {COMMON_COMMANDS.filter((c) => match(t(c.key))).map((c) => {
          const Icon = c.icon
          const command = c.cmd(pm)
          return (
            <Tooltip key={c.key} title={command}>
              <button
                type="button"
                className="script-list-item btn-with-icon"
                onClick={() => void runRaw(selected.path, selected.folderName, command)}
              >
                <Icon className="ui-icon" size={11} color="currentColor" aria-hidden />
                <span className="script-list-name">{t(c.key)}</span>
                <span className="script-list-cmd muted">{command}</span>
              </button>
            </Tooltip>
          )
        })}
      </div>

      {ctxMenu && (
        <ContextMenuPortal
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        >
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              void useSettingsStore.getState().deleteHistory(selected.path, 'command', ctxMenu.originalValue)
              setCtxMenu(null)
            }}
          >
            <Trash size={14} color="currentColor" />
            {t('history.delete')}
          </button>
        </ContextMenuPortal>
      )}
    </div>
  )
}
