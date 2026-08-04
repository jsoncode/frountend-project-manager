import { Play } from 'reicon-react'
import { useI18n } from '../i18n/useI18n'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTerminalStore } from '../stores/terminalStore'
import { HistoryChips } from './HistoryChips'
import { Tooltip } from './Tooltip'

/** npm/pnpm/yarn scripts — shown inside the action bar. */
export function CommandPanel({ filterQuery = '' }: { filterQuery?: string }) {
  const selected = useProjectStore((s) => s.selected)
  const details = useProjectStore((s) => s.details)
  const runScript = useTerminalStore((s) => s.runScript)
  const runRaw = useTerminalStore((s) => s.runRaw)
  const config = useSettingsStore((s) => s.config)
  const setHistoryPinned = useSettingsStore((s) => s.setHistoryPinned)
  const deleteHistory = useSettingsStore((s) => s.deleteHistory)
  const { t } = useI18n()

  if (!selected || !details) {
    return <div className="muted">{t('cmd.selectProject')}</div>
  }

  const q = filterQuery.trim().toLowerCase()
  const match = (text: string) => !q || text.toLowerCase().includes(q)

  // Keep package.json scripts key order (do not re-sort).
  const scripts = Object.keys(details.summary.scripts).filter(match)
  const pm = details.packageManager
  const history = (config?.commandHistory?.[selected.path] ?? [])
    .filter((h) => match(h.value))
    .sort((a, b) => a.value.localeCompare(b.value))

  return (
    <div className="command-panel-side">
      <div className="pane-sub">
        {t('cmd.title')} · {pm}
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

      <HistoryChips
        title={t('cmd.history')}
        items={history}
        emptyText={q ? t('actionBar.noMatch') : t('cmd.historyEmpty')}
        onRun={(cmd) => {
          const full = pm === 'npm' ? `npm run ${cmd}` : `${pm} ${cmd}`
          void useSettingsStore.getState().touchCommandHistory(selected.path, cmd)
          void runRaw(selected.path, selected.folderName, full)
        }}
        onTogglePin={(value, pinned) =>
          void setHistoryPinned(selected.path, 'command', value, pinned)
        }
        onDelete={(value) => void deleteHistory(selected.path, 'command', value)}
      />
    </div>
  )
}
