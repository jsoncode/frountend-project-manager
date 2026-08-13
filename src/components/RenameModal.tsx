import { Button, Input, type InputRef } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { ModalShell } from './ModalShell'

type Props = {
  initial: string
  /** For files: preselect the basename without extension (VS Code style). */
  selectStem?: boolean
  /** Resolve the rename; return an error message, or null on success. */
  onSubmit: (newName: string) => Promise<string | null>
  onClose: () => void
}

/** Prompt for a new file/folder name and submit it to the caller. */
export function RenameModal({ initial, selectStem, onSubmit, onClose }: Props) {
  const { t } = useI18n()
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<InputRef>(null)

  useEffect(() => {
    const el = inputRef.current
    const native = el?.nativeElement as HTMLInputElement | null
    if (!native) return
    native.focus()
    if (selectStem) {
      const dot = initial.lastIndexOf('.')
      native.setSelectionRange(0, dot > 0 ? dot : initial.length)
    } else {
      native.select()
    }
  }, [initial, selectStem])

  const submit = async () => {
    const name = value.trim()
    if (busy) return
    if (!name || name === initial) {
      onClose()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const err = await onSubmit(name)
      if (err) setError(err)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title={t('fs.rename')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('branch.cancel')}</Button>
          <Button type="primary" disabled={busy} onClick={() => void submit()}>
            {t('fs.rename')}
          </Button>
        </>
      }
    >
      <label className="muted" style={{ display: 'block', marginBottom: 6 }}>
        {t('fs.newName')}
      </label>
      <Input
        ref={inputRef}
        className="input-block"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onPressEnter={() => void submit()}
      />
      {error && <p className="branch-menu-error" style={{ marginTop: 8 }}>{error}</p>}
    </ModalShell>
  )
}
