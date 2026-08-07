import {
  ChatRoundDots,
  Database,
  Language,
  Monitor,
  Search,
  TerminalSquare,
  Trash,
  X,
} from 'reicon-react'
import { useMemo, useState } from 'react'
import * as monaco from 'monaco-editor'
import { useI18n } from '../i18n/useI18n'
import { EDITOR_THEMS, applyEditorTheme, registerEditorThemes } from '../lib/monacoThemes'
import { useSettingsStore } from '../stores/settingsStore'
import { AiSettingsModal } from './AiSettingsModal'
import { IdeSettingsModal } from './IdeSettingsModal'
import { JenCliSettingsModal } from './JenCliSettingsModal'
import { ModalShell } from './ModalShell'
import { ThemeCodePreview } from './ThemeCodePreview'

type SettingsCategory = 'general' | 'ide' | 'ai' | 'jencli' | 'cache'

/** Map theme id to a preview background color for the theme card */
function getThemePreviewColor(themeId: string): string {
  switch (themeId) {
    case 'vs-dark': return '#1e1e1e'
    case 'fpm-dark': return '#1E1E2E'
    case 'fpm-midnight': return '#0D1117'
    case 'fpm-dracula': return '#282A36'
    case 'vs': return '#ffffff'
    case 'hc-black': return '#000000'
    default: return '#1e1e1e'
  }
}

const CATEGORY_ICONS: Record<SettingsCategory, typeof Language> = {
  general: Language,
  ide: Monitor,
  ai: ChatRoundDots,
  jencli: TerminalSquare,
  cache: Database,
}

/** Keywords per category for search filtering */
const CATEGORY_KEYWORDS: Record<SettingsCategory, string[]> = {
  general: ['language', 'theme', 'editor', 'general', '语言', '主题', '常规', '界面'],
  ide: ['ide', 'editor', 'vscode', 'webstorm', 'cursor', '编辑器', '打开方式'],
  ai: ['ai', 'model', 'openai', 'chat', '模型', '对话'],
  jencli: ['jenkins', 'jen-cli', 'cli', 'server', '服务器'],
  cache: ['cache', 'clear', '缓存', '清除', '清理'],
}

export function SettingsModal() {
  const open = useSettingsStore((s) => s.settingsOpen)
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen)
  const clearProjectCache = useSettingsStore((s) => s.clearProjectCache)
  const clearAiConversations = useSettingsStore((s) => s.clearAiConversations)
  const setEditorTheme = useSettingsStore((s) => s.setEditorTheme)
  const editorTheme = useSettingsStore((s) => s.config?.editorTheme ?? 'vs-dark')
  const { locale, setLocale, t } = useI18n()
  const [clearing, setClearing] = useState<'project' | 'ai' | null>(null)
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general')
  const [searchQuery, setSearchQuery] = useState('')

  // Register custom themes once
  registerEditorThemes(monaco)

  // Filter categories by search query (must run before early return to keep hooks order stable)
  const allCategories: { id: SettingsCategory; label: string }[] = [
    { id: 'general', label: t('settings.catGeneral') },
    { id: 'ide', label: t('settings.catIde') },
    { id: 'ai', label: t('settings.catAi') },
    { id: 'jencli', label: t('settings.catJenCli') },
    { id: 'cache', label: t('settings.catCache') },
  ]

  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return allCategories
    return allCategories.filter((cat) => {
      const keywords = CATEGORY_KEYWORDS[cat.id]
      return (
        cat.label.toLowerCase().includes(q) ||
        keywords.some((kw) => kw.toLowerCase().includes(q))
      )
    })
  }, [searchQuery, allCategories])

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

  // Auto-select first filtered category when searching
  const effectiveCategory = filteredCategories.some((c) => c.id === activeCategory)
    ? activeCategory
    : filteredCategories[0]?.id ?? 'general'

  const renderPanel = () => {
    switch (effectiveCategory) {
      case 'general':
        return (
          <>
            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-row-label">
                  <h4>{t('settings.language')}</h4>
                  <p className="muted">{t('settings.languageHint')}</p>
                </div>
                <div className="settings-row-control">
                  <div className="lang-switch">
                    <button
                      type="button"
                      className={`btn btn-sm ${locale === 'zh' ? 'primary' : ''}`}
                      onClick={() => void setLocale('zh')}
                    >
                      {t('settings.zh')}
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${locale === 'en' ? 'primary' : ''}`}
                      onClick={() => void setLocale('en')}
                    >
                      {t('settings.en')}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-title">{t('settings.editorTheme')}</div>
              <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>{t('settings.editorThemeHint')}</p>
              <div className="editor-theme-grid">
                {EDITOR_THEMS.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    className={`editor-theme-card${editorTheme === theme.id ? ' active' : ''}`}
                    onClick={() => {
                      void setEditorTheme(theme.id)
                      applyEditorTheme(monaco, theme.id)
                    }}
                  >
                    <div
                      className="editor-theme-preview"
                      style={{ background: getThemePreviewColor(theme.id) }}
                    />
                    <span className="editor-theme-name">
                      {t(`theme.${theme.id}` as keyof typeof t)}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="theme-code-preview-wrapper">
              <ThemeCodePreview />
            </div>
          </>
        )

      case 'ide':
        return <IdeSettingsModal inline onClosePanel={() => setActiveCategory('general')} />

      case 'ai':
        return <AiSettingsModal inline onClosePanel={() => setActiveCategory('general')} />

      case 'jencli':
        return <JenCliSettingsModal inline onClosePanel={() => setActiveCategory('general')} />

      case 'cache':
        return (
          <>
            <div className="settings-group">
              <div className="settings-group-title">{t('settings.cacheSection')}</div>
              <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>{t('settings.cacheHint')}</p>

              <div className="cache-item">
                <div>
                  <div className="cache-item-title">{t('settings.clearProjectCache')}</div>
                  <div className="muted">{t('settings.clearProjectCacheHint')}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm danger btn-with-icon"
                  disabled={clearing !== null}
                  onClick={() => void handleClear('project')}
                >
                  <Trash className="ui-icon" size={14} color="currentColor" aria-hidden />
                  {clearing === 'project' ? t('settings.clearing') : t('settings.clear')}
                </button>
              </div>

              <div className="cache-item">
                <div>
                  <div className="cache-item-title">{t('settings.clearAiConversations')}</div>
                  <div className="muted">{t('settings.clearAiConversationsHint')}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm danger btn-with-icon"
                  disabled={clearing !== null}
                  onClick={() => void handleClear('ai')}
                >
                  <Trash className="ui-icon" size={14} color="currentColor" aria-hidden />
                  {clearing === 'ai' ? t('settings.clearing') : t('settings.clear')}
                </button>
              </div>
            </div>
          </>
        )
    }
  }

  return (
    <ModalShell title={t('settings.title')} onClose={() => setSettingsOpen(false)} wide className="settings-modal-root">
      <div className="settings-layout">
        {/* Left sidebar — category list */}
        <div className="settings-sidebar">
          {/* Search box */}
          <div className="settings-search-box">
            <Search className="ui-icon" size={14} color="currentColor" aria-hidden />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('settings.searchPlaceholder')}
            />
            {searchQuery && (
              <button
                type="button"
                className="settings-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="clear"
              >
                <X className="ui-icon" size={12} color="currentColor" aria-hidden />
              </button>
            )}
          </div>

          {/* Category header */}
          <div className="settings-sidebar-header">{t('settings.userSettings')}</div>

          {/* Category nav */}
          <nav className="settings-nav">
            {filteredCategories.map((cat) => {
              const Icon = CATEGORY_ICONS[cat.id]
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`settings-nav-item${effectiveCategory === cat.id ? ' active' : ''}`}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  <Icon className="ui-icon" size={15} color="currentColor" aria-hidden />
                  <span>{cat.label}</span>
                </button>
              )
            })}
            {filteredCategories.length === 0 && (
              <div className="settings-nav-empty">{t('settings.noMatch')}</div>
            )}
          </nav>
        </div>

        {/* Right panel — settings content */}
        <div className="settings-content">
          {renderPanel()}
        </div>
      </div>
    </ModalShell>
  )
}
