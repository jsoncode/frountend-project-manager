import { Button } from 'antd'
import { useState } from 'react'
import { ModalShell } from './ModalShell'
import { useI18n } from '../i18n/useI18n'
import { useErrorLogStore } from '../stores/errorLogStore'

export function ErrorLogModal() {
  const { t } = useI18n()
  const message = useErrorLogStore((s) => s.message)
  const title = useErrorLogStore((s) => s.title)
  const clear = useErrorLogStore((s) => s.clear)
  const [copied, setCopied] = useState(false)

  if (!message) return null

  const copyMessage = () => {
    void navigator.clipboard
      .writeText(message)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => undefined)
  }

  return (
    <ModalShell
      title={title || t('error.logTitle')}
      onClose={clear}
      elevated
      className="error-log-modal"
      footer={
        <>
          <Button onClick={copyMessage}>
            {copied ? t('error.copied') : t('error.copy')}
          </Button>
          <Button type="primary" onClick={clear}>
            {t('settings.close')}
          </Button>
        </>
      }
    >
      <pre className="error-log-body">{message}</pre>
    </ModalShell>
  )
}
