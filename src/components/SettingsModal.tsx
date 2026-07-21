import { useI18n } from '../i18n/useI18n'
import { useSettingsStore } from '../stores/settingsStore'
import { ModalShell } from './ModalShell'

export function SettingsModal() {
  const open = useSettingsStore((s) => s.settingsOpen)
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen)
  const setIdeModalOpen = useSettingsStore((s) => s.setIdeModalOpen)
  const { locale, setLocale, t } = useI18n()

  if (!open) return null

  return (
    <ModalShell title={t('settings.title')} onClose={() => setSettingsOpen(false)} className="settings-modal">
      <section className="settings-section">
        <h4>{t('settings.language')}</h4>
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
        <h4>{t('settings.ideSection')}</h4>
        <p className="muted">{t('settings.ideHint')}</p>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setSettingsOpen(false)
            setIdeModalOpen(true)
          }}
        >
          {t('settings.openIde')}
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
