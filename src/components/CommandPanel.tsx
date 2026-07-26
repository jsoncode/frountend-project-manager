import { Play } from 'reicon-react'
import { useI18n } from '../i18n/useI18n'
import { HistoryChips } from './HistoryChips'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTerminalStore } from '../stores/terminalStore'

/** npm/pnpm/yarn scripts — shown inside the right tool panel. */
export function CommandPanel() {
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

  // Keep package.json scripts key order (do not re-sort).
  const scripts = Object.keys(details.summary.scripts)
  const pm = details.packageManager
  const history = config?.commandHistory?.[selected.path] ?? []

  return (
    <div className="command-panel-side">
      <div className="pane-sub">
        {t('cmd.title')} · {pm}
      </div>
      <div className="script-list">
        {scripts.map((name) => (
          <button
            key={name}
            type="button"
            className="script-list-item btn-with-icon"
            title={details.summary.scripts[name]}
            onClick={() =>
              void runScript(selected.path, selected.folderName, pm, name)
            }
          >
            <Play className="ui-icon" size={11} color="currentColor" aria-hidden />
            <span className="script-list-name">{name}</span>
          </button>
        ))}
        {scripts.length === 0 && (
          <span className="muted">{t('cmd.noScripts')}</span>
        )}
      </div>

      <HistoryChips
        title={t('cmd.history')}
        items={history}
        emptyText={t('cmd.historyEmpty')}
        onRun={(cmd) => {
          void useSettingsStore.getState().touchCommandHistory(selected.path, cmd)
          void runRaw(selected.path, selected.folderName, cmd)
        }}
        onTogglePin={(value, pinned) =>
          void setHistoryPinned(selected.path, 'command', value, pinned)
        }
        onDelete={(value) => void deleteHistory(selected.path, 'command', value)}
      />
    </div>
  )
}
