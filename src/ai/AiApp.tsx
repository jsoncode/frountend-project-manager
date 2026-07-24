import { useEffect } from 'react'
import { useI18n } from '../i18n/useI18n'
import { useAiStore } from '../stores/aiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { AiTopBar } from './AiTopBar'
import '../styles/tokens.css'
import '../styles/app.css'
import '../styles/ai.css'

export default function AiApp() {
  const { t } = useI18n()

  useEffect(() => {
    void useSettingsStore.getState().load()
    void useAiStore.getState().load()
  }, [])

  return (
    <div className="ai-app">
      <aside className="ai-sidebar">
        <div className="ai-sidebar-header">
          <span className="ai-sidebar-title">{t('ai.title')}</span>
          <button type="button" className="ai-btn ai-btn-sm" disabled>
            {t('ai.newChat')}
          </button>
        </div>
        <div className="ai-sidebar-groups">
          <section className="ai-sidebar-group">
            <h2 className="ai-sidebar-group-title">{t('ai.recentMonth')}</h2>
            <p className="ai-sidebar-placeholder">{t('ai.empty')}</p>
          </section>
          <section className="ai-sidebar-group">
            <h2 className="ai-sidebar-group-title">{t('ai.older')}</h2>
            <p className="ai-sidebar-placeholder">{t('ai.empty')}</p>
          </section>
        </div>
      </aside>

      <div className="ai-main">
        <AiTopBar />

        <main className="ai-messages">
          <p className="ai-messages-empty">{t('ai.empty')}</p>
        </main>

        <footer className="ai-composer">
          <div className="ai-composer-toggles">
            <label className="ai-toggle">
              <input type="checkbox" disabled />
              <span>{t('ai.stream')}</span>
            </label>
            <label className="ai-toggle">
              <input type="checkbox" disabled />
              <span>{t('ai.think')}</span>
            </label>
            <label className="ai-toggle">
              <input type="checkbox" disabled />
              <span>{t('ai.code')}</span>
            </label>
          </div>
          <div className="ai-composer-row">
            <textarea
              className="ai-composer-input"
              rows={2}
              disabled
              placeholder={t('ai.empty')}
            />
            <button type="button" className="ai-btn ai-btn-primary" disabled>
              {t('ai.send')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
