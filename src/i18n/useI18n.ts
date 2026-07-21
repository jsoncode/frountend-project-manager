import { useMemo } from 'react'
import {
  normalizeLocale,
  translate,
  type Locale,
  type MessageKey,
} from './messages'
import { useSettingsStore } from '../stores/settingsStore'

export function useI18n() {
  const locale = normalizeLocale(useSettingsStore((s) => s.config?.locale))
  const setLocale = useSettingsStore((s) => s.setLocale)

  const t = useMemo(() => {
    return (key: MessageKey, vars?: Record<string, string | number>) =>
      translate(locale, key, vars)
  }, [locale])

  return { locale: locale as Locale, setLocale, t }
}
