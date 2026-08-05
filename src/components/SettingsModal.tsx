import {
  ChatRoundDots,
  Database,
  Language,
  Monitor,
  Settings,
  TerminalSquare,
  Trash,
} from 'reicon-react'
import { useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useSettingsStore } from '../stores/settingsStore'
import { ModalShell } from './ModalShell'

export function SettingsModal() {
  const open = useSettingsStore((s) => s.settingsOpen)
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen)
  const setIdeModalOpen = useSettingsStore((s) => s.setIdeModalOpen)
  const setAiSettingsOpen = useSettingsStore((s) => s.setAiSettingsOpen)
  const setJenCliModalOpen = useSettingsStore((s) => s.setJenCliModalOpen)
  const clearProjectCache = useSettingsStore((s) => s.clearProjectCache)
  const clearAiConversations = useSettingsStore((s) => s.clearAiConversations)
  const { locale, setLocale, t } = useI18n()
  const [clearing, setClearing] = useState<'project' | 'ai' | null>(null)

  if (!open) return null

  const handleClear = async (kind: 'project' | 'ai') => {
    if (!window.confirm(t('settings.clearConfirm'))) return
    setClearing(kind)
    try {
      if (kind === 'project') await clearProjectCache()
      else await clearAiConversations()
      window.alert(t('settings.clearSuccess'))
    } catch (e) {
      window.alert(String(e))
    } finally {
      setClearing(null)
    }
  }

  return (
    <ModalShell title={t('settings.title')} onClose={() => setSettingsOpen(false)} className="settings-modal">
      <section className="settings-section">
        <h4 className="btn-with-icon">
          <Language className="ui-icon" size={15} color="currentColor" aria-hidden />
          {t('settings.language')}
        </h4>
        <p className="muted">{t('settings.languageHint')}</p>
        <div className="lang-switch">
          <button
            type="button"
            className={`btn ${locale === 'zh' ? 'primary' : ''}`}
            onClick={() => void setLocale('zh')}
          >
            {t('settings.zh')}
          </button>
          <button
            type="button"
            className={`btn ${locale === 'en' ? 'primary' : ''}`}
            onClick={() => void setLocale('en')}
          >
            {t('settings.en')}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h4 className="btn-with-icon">
          <Monitor className="ui-icon" size={15} color="currentColor" aria-hidden />
          {t('settings.ideSection')}
        </h4>
        <p className="muted">{t('settings.ideHint')}</p>
        <button
          type="button"
          className="btn primary btn-with-icon"
          onClick={() => {
            setSettingsOpen(false)
            setIdeModalOpen(true)
          }}
        >
          <Settings className="ui-icon" size={14} color="currentColor" aria-hidden />
          {t('settings.openIde')}
        </button>
      </section>

      <section className="settings-section">
        <h4 className="btn-with-icon">
          <ChatRoundDots className="ui-icon" size={15} color="currentColor" aria-hidden />
          {t('settings.aiSection')}
        </h4>
        <p className="muted">{t('settings.aiHint')}</p>
        <button
          type="button"
          className="btn primary btn-with-icon"
          onClick={() => {
            setAiSettingsOpen(true)
          }}
        >
          <ChatRoundDots className="ui-icon" size={14} color="currentColor" aria-hidden />
          {t('settings.openAi')}
        </button>
      </section>

      <section className="settings-section">
        <h4 className="btn-with-icon">
          <TerminalSquare className="ui-icon" size={15} color="currentColor" aria-hidden />
          {t('settings.jenCliSection')}
        </h4>
        <p className="muted">{t('settings.jenCliHint')}</p>
        <button
          type="button"
          className="btn primary btn-with-icon"
          onClick={() => {
            setSettingsOpen(false)
            setJenCliModalOpen(true)
          }}
        >
          <TerminalSquare className="ui-icon" size={14} color="currentColor" aria-hidden />
          {t('settings.openJenCli')}
        </button>
      </section>

      <section className="settings-section">
        <h4 className="btn-with-icon">
          <Database className="ui-icon" size={15} color="currentColor" aria-hidden />
          {t('settings.cacheSection')}
        </h4>
        <p className="muted">{t('settings.cacheHint')}</p>

        <div className="cache-item">
          <div>
            <div className="cache-item-title">{t('settings.clearProjectCache')}</div>
            <div className="muted">{t('settings.clearProjectCacheHint')}</div>
          </div>
          <button
            type="button"
            className="btn danger btn-with-icon"
            disabled={clearing !== null}
            onClick={() => void handleClear('project')}
          >
            <Trash className="ui-icon" size={14} color="currentColor" aria-hidden />
            {clearing === 'project' ? t('settings.clearing') : t('settings.clearProjectCache')}
          </button>
        </div>

        <div className="cache-item">
          <div>
            <div className="cache-item-title">{t('settings.clearAiConversations')}</div>
            <div className="muted">{t('settings.clearAiConversationsHint')}</div>
          </div>
          <button
            type="button"
            className="btn danger btn-with-icon"
            disabled={clearing !== null}
            onClick={() => void handleClear('ai')}
          >
            <Trash className="ui-icon" size={14} color="currentColor" aria-hidden />
            {clearing === 'ai' ? t('settings.clearing') : t('settings.clearAiConversations')}
          </button>
        </div>
      </section>

      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => setSettingsOpen(false)}>
          {t('settings.close')}
        </button>
      </div>
    </ModalShell>
  )
}
