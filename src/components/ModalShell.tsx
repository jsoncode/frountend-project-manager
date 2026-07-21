import type { ReactNode } from 'react'
import { useI18n } from '../i18n/useI18n'

type Props = {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
  wide?: boolean
}

/** Backdrop does not dismiss — close via the header × button (or footer actions). */
export function ModalShell({ title, onClose, children, className = '', wide }: Props) {
  const { t } = useI18n()

  return (
    <div className="modal-backdrop">
      <div className={`modal ${wide ? 'modal-wide' : ''} ${className}`.trim()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button
            type="button"
            className="modal-close"
            title={t('settings.close')}
            aria-label={t('settings.close')}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
