import {
  ChatRoundDots,
  Language,
  Monitor,
  Settings,
} from 'reicon-react'
import { useI18n } from '../i18n/useI18n'
import { useSettingsStore } from '../stores/settingsStore'
import { ModalShell } from './ModalShell'

export function SettingsModal() {
  const open = useSettingsStore((s) => s.settingsOpen)
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen)
  const setIdeModalOpen = useSettingsStore((s) => s.setIdeModalOpen)
  const setAiSettingsOpen = useSettingsStore((s) => s.setAiSettingsOpen)
  const { locale, setLocale, t } = useI18n()

  if (!open) return null

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

      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => setSettingsOpen(false)}>
          {t('settings.close')}
        </button>
      </div>
    </ModalShell>
  )
}
