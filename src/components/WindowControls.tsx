import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'
import { isTauri } from '../lib/tauri'
import { useI18n } from '../i18n/useI18n'
import { Tooltip } from './Tooltip'

export function WindowControls() {
  const { t } = useI18n()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!isTauri()) return
    const win = getCurrentWindow()
    let unlisten: (() => void) | undefined
    let alive = true

    void win.isMaximized().then(setMaximized).catch(() => undefined)
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized).catch(() => undefined)
      })
      .then((fn) => {
        // If the component unmounted while `onResized` was being awaited, the
        // listener must be dropped immediately instead of leaking (audit QO-5).
        if (alive) unlisten = fn
        else fn()
      })

    return () => {
      alive = false
      unlisten?.()
    }
  }, [])

  if (!isTauri()) return null

  const win = getCurrentWindow()

  return (
    <div className="window-controls">
      <Tooltip title={t('window.minimize')} placement="bottom">
        <button
          type="button"
          className="window-ctrl"
          aria-label={t('window.minimize')}
          onClick={() => void win.minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path fill="currentColor" d="M0 5h10v1H0z" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip title={maximized ? t('window.restore') : t('window.maximize')} placement="bottom">
        <button
          id="titlebar-maximize"
          type="button"
          className="window-ctrl"
          aria-label={maximized ? t('window.restore') : t('window.maximize')}
          onClick={() => void win.toggleMaximize()}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                d="M2.5 3.5h5v5h-5zM3.5 2.5h5v5"
              />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect
                x="1.5"
                y="1.5"
                width="7"
                height="7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          )}
        </button>
      </Tooltip>
      <Tooltip title={t('window.close')} placement="bottom">
        <button
          type="button"
          className="window-ctrl window-ctrl-close"
          aria-label={t('window.close')}
          onClick={() => void win.close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path
              fill="currentColor"
              d="M1.2 1.2l7.6 7.6-.7.7L.5 1.9l.7-.7zm7.6 0l.7.7-7.6 7.6-.7-.7L8.8 1.2z"
            />
          </svg>
        </button>
      </Tooltip>
    </div>
  )
}
