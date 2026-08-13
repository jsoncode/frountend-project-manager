import { CloseOutlined } from '@ant-design/icons'
import { Button, Modal } from 'antd'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, type ReactNode } from 'react'
import { useI18n } from '../i18n/useI18n'
import { isTauri } from '../lib/tauri'
import { Tooltip } from './Tooltip'

/**
 * Start a native window drag when the user presses on the backdrop area
 * (the dim region around the modal). Double-click toggles maximize,
 * matching the titlebar behaviour.
 */
function onMaskMouseDown(e: globalThis.MouseEvent) {
  if (!isTauri()) return
  if (e.button !== 0) return
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

let modalSeq = 0

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
  const rootClass = useRef(`modal-shell-${++modalSeq}`).current
  const zIndex = nested ? 1200 : elevated ? 1100 : 1000
  const { t } = useI18n()

  // Wire the native window drag onto the antd mask element once mounted.
  useEffect(() => {
    if (!isTauri()) return
    const mask = document.querySelector<HTMLElement>(
      `.${rootClass} .ant-modal-mask`,
    )
    if (!mask) return
    mask.addEventListener('mousedown', onMaskMouseDown)
    return () => mask.removeEventListener('mousedown', onMaskMouseDown)
  }, [rootClass])

  return (
    <Modal
      rootClassName={`modal-shell-root ${rootClass}`}
      className={`modal-shell ${className}`.trim()}
      open
      // 自定义标题栏（flex 布局，关闭按钮与标题垂直居中对齐）
      closable={false}
      title={
        <div className="modal-shell-title-row">
          <span className="modal-shell-title-text">{title}</span>
          <Tooltip title={t('settings.close')}>
            <Button
              type="text"
              size="small"
              className="modal-shell-close"
              aria-label={t('settings.close')}
              onClick={onClose}
            >
              <CloseOutlined style={{ fontSize: 13 }} />
            </Button>
          </Tooltip>
        </div>
      }
      onCancel={onClose}
      footer={footer ?? null}
      width={wide ? 960 : 720}
      zIndex={zIndex}
      maskClosable={false}
      keyboard={closeOnEsc}
      destroyOnHidden
    >
      {children}
    </Modal>
  )
}
