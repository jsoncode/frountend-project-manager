import { Button, Input, type InputRef } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { createNewWorkspace } from '../lib/workspaceActions'
import { showErrorLog } from '../stores/errorLogStore'
import { useWorkspaceUiStore } from '../stores/workspaceUiStore'
import { ModalShell } from './ModalShell'

export function NewWorkspaceModal() {
  const { t } = useI18n()
  const open = useWorkspaceUiStore((s) => s.newWorkspaceOpen)
  const close = useWorkspaceUiStore((s) => s.closeNewWorkspace)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<InputRef>(null)

  useEffect(() => {
    if (!open) return
    setNewName('')
    const tmr = window.setTimeout(() => inputRef.current?.focus(), 40)
    return () => window.clearTimeout(tmr)
  }, [open])

  const confirmCreate = async () => {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      close()
      await createNewWorkspace(name)
    } catch (e) {
      showErrorLog(e)
    } finally {
      setBusy(false)
      setNewName('')
    }
  }

  if (!open) return null

  return (
    <ModalShell
      title={t('menu.newWorkspace')}
      onClose={() => {
        if (!busy) close()
      }}
      footer={
        <>
          <Button disabled={busy} onClick={close}>
            {t('branch.cancel')}
          </Button>
          <Button
            type="primary"
            disabled={busy || !newName.trim()}
            onClick={() => void confirmCreate()}
          >
            {t('menu.newWorkspaceNext')}
          </Button>
        </>
      }
    >
      <p className="muted">{t('menu.newWorkspaceHint')}</p>
      <Input
        ref={inputRef}
        className="input-block"
        value={newName}
        placeholder={t('menu.newWorkspacePlaceholder')}
        onChange={(e) => setNewName(e.target.value)}
        onPressEnter={() => void confirmCreate()}
        disabled={busy}
      />
    </ModalShell>
  )
}
