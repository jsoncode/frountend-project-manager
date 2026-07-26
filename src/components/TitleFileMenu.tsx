import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { showErrorLog } from '../stores/errorLogStore'
import { useWorkspaceUiStore } from '../stores/workspaceUiStore'
import { addExistingWorkspace } from '../lib/workspaceActions'

/** VS Code–style File menu inside the custom title bar. */
export function TitleFileMenu() {
  const { t } = useI18n()
  const openNewWorkspace = useWorkspaceUiStore((s) => s.openNewWorkspace)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="title-menu" ref={wrapRef}>
      <button
        type="button"
        className={`title-menu-btn ${open ? 'open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {t('menu.file')}
      </button>
      {open && (
        <div className="title-menu-dropdown" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void addExistingWorkspace().catch(showErrorLog)
            }}
          >
            {t('menu.addWorkspace')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              openNewWorkspace()
            }}
          >
            {t('menu.newWorkspace')}
          </button>
        </div>
      )}
    </div>
  )
}
