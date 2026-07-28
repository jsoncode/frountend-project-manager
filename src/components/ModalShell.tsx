import { X } from 'reicon-react'
import { useEffect, type ReactNode } from 'react'
import { useI18n } from '../i18n/useI18n'
import { Tooltip } from './Tooltip'

type Props = {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
  wide?: boolean
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
    <div className={`modal-backdrop${stackClass}`}>
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
        {children}
      </div>
    </div>
  )
}
