import { ProjectHeader } from './ProjectHeader'
import { TerminalPanel } from './TerminalPanel'
import { ToolWindow } from './ToolWindow'
import { useI18n } from '../i18n/useI18n'
import { useProjectStore } from '../stores/projectStore'

export function DetailPane() {
  const selected = useProjectStore((s) => s.selected)
  const { t } = useI18n()

  if (!selected) {
    return (
      <section className="detail-pane">
        <div className="detail-body detail-body-empty">
          <div className="empty">{t('app.selectProject')}</div>
          <ToolWindow />
        </div>
      </section>
    )
  }

  return (
    <section className="detail-pane">
      <ProjectHeader />
      <div className="detail-body">
        <div className="main-col">
          <TerminalPanel />
        </div>
        <ToolWindow />
      </div>
    </section>
  )
}
