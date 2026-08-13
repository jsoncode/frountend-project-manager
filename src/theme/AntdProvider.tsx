import { App as AntdApp, ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import type { ReactNode } from 'react'
import { normalizeLocale } from '../i18n/messages'
import { useSettingsStore } from '../stores/settingsStore'
import { antdTheme } from './antdTheme'

/**
 * antd 6 root: ConfigProvider (Frost Glass dark theme + UI locale) and the
 * antd <App> context so message/modal/notification hooks share the theme.
 */
export function AntdProvider({ children }: { children: ReactNode }) {
  const locale = normalizeLocale(useSettingsStore((s) => s.config?.locale))

  return (
    <ConfigProvider locale={locale === 'zh' ? zhCN : enUS} theme={antdTheme}>
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  )
}
