import { X } from 'reicon-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, type MouseEvent, type ReactNode } from 'react'
import { useI18n } from '../i18n/useI18n'
import { isTauri } from '../lib/tauri'
import { Tooltip } from './Tooltip'

/**
 * Start a native window drag when the user presses on the backdrop area
 * (the dim region around the modal). Clicks inside the modal content are
 * excluded so form controls and scroll areas keep working normally.
 * Double-click toggles maximize, matching the titlebar behaviour.
 */
function onBackdropMouseDown(e: MouseEvent) {
  if (!isTauri()) return
  if (e.button !== 0) return
  // Only drag when clicking the backdrop itself, not the modal content.
  if (e.target !== e.currentTarget) return
  if (e.detail === 2) {
    void getCurrentWindow().toggleMaximize()
    return
  }
  void getCurrentWindow().startDragging()
}

type Props = {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
  wide?: boolean
  /** Optional fixed footer rendered below the scrollable body. */
  footer?: ReactNode
  /** Stack above another open modal (e.g. settings → AI models). */
  elevated?: boolean
  /** Stack above an already elevated modal (e.g. model list → editor). */
  nested?: boolean
  /**
   * Hint / form dialogs: Escape closes (default).
   * Confirmation dialogs: set false so Esc cannot dismiss.
   */
  closeOnEsc?: boolean
}

/** Backdrop does not dismiss — close via the header × button (or footer actions). */
export function ModalShell({
  title,
  onClose,
  children,
  className = '',
  wide,
  footer,
  elevated,
  nested,
  closeOnEsc = true,
}: Props) {
  const { t } = useI18n()
  const stackClass = nested ? ' nested' : elevated ? ' elevated' : ''

  useEffect(() => {
    if (!closeOnEsc) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeOnEsc, onClose])

  return (
    <div className={`modal-backdrop${stackClass}`} onMouseDown={onBackdropMouseDown}>
      <div className={`modal ${wide ? 'modal-wide' : ''} ${className}`.trim()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <Tooltip title={t('settings.close')}>
            <button
              type="button"
              className="modal-close"
              aria-label={t('settings.close')}
              onClick={onClose}
            >
              <X className="ui-icon" size={16} color="currentColor" aria-hidden />
            </button>
          </Tooltip>
        </div>
        <div className="modal-body">
          {children}
        </div>
        {footer && (
          <div className="modal-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
