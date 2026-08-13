import { CodeScan, Copy, FolderOpen } from 'reicon-react'
import { invoke } from '@tauri-apps/api/core'
import { useCallback, type ReactNode } from 'react'
import { useI18n } from '../i18n/useI18n'
import { showErrorLog } from '../stores/errorLogStore'
import { useSettingsStore } from '../stores/settingsStore'
import { ContextMenuPortal } from './ContextMenuPortal'
import { IdeIcon } from './IdeIcon'
import { SubMenuGroup, SubMenuItem } from './SubMenuItem'

type Props = {
  path: string
  x: number
  y: number
  onClose: () => void
  /** Extra items below the shared open/copy/reveal actions (e.g. workspace refresh/remove). */
  children?: ReactNode
  /** Collapse the IDE list into a "用 IDE 打开" flyout submenu (project menu). */
  ideAsSubmenu?: boolean
}

export function OpenWithMenu({ path, x, y, onClose, children, ideAsSubmenu = false }: Props) {
  const config = useSettingsStore((s) => s.config)
  const { t } = useI18n()
  const ides = (config?.ides ?? []).filter((i) => i.enabled)

  const close = useCallback(() => onClose(), [onClose])

  const openIde = async (ideId: string) => {
    try {
      await invoke('open_in_ide', { ideId, projectPath: path })
      onClose()
    } catch (e) {
      onClose()
      showErrorLog(e)
    }
  }

  const reveal = async () => {
    try {
      await invoke('reveal_in_file_manager', { path })
      onClose()
    } catch (e) {
      onClose()
      showErrorLog(e)
    }
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* ignore */
    }
    onClose()
  }

  const fileName = path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || path

  const ideButtons = (
    <>
      {ides.map((ide) => (
        <button
          key={ide.id}
          type="button"
          role="menuitem"
          className="open-with-ide"
          onClick={() => void openIde(ide.id)}
        >
          <IdeIcon iconPath={ide.iconPath} name={ide.name} size={16} />
          <span>{t('open.withIde', { name: ide.name })}</span>
        </button>
      ))}
      {ides.length === 0 && (
        <div className="branch-menu-hint muted">{t('open.noIde')}</div>
      )}
    </>
  )

  return (
    <ContextMenuPortal x={x} y={y} onClose={close}>
      <SubMenuGroup>
        {ideAsSubmenu ? (
          <SubMenuItem
            id="ide"
            icon={<CodeScan className="ui-icon" size={14} color="currentColor" aria-hidden />}
            label={t('open.inIde')}
          >
            {ideButtons}
          </SubMenuItem>
        ) : (
          ideButtons
        )}
        <div className="branch-menu-sep" />
        <button type="button" role="menuitem" className="btn-with-icon" onClick={() => void copyText(path)}>
          <Copy className="ui-icon" size={14} color="currentColor" aria-hidden />
          {t('explorer.copyPath')}
        </button>
        <button type="button" role="menuitem" className="btn-with-icon" onClick={() => void copyText(fileName)}>
          <Copy className="ui-icon" size={14} color="currentColor" aria-hidden />
          {t('explorer.copyName')}
        </button>
        <button type="button" role="menuitem" className="btn-with-icon" onClick={() => void reveal()}>
          <FolderOpen className="ui-icon" size={14} color="currentColor" aria-hidden />
          {t('open.inFileManager')}
        </button>
        {children ? (
          <>
            <div className="branch-menu-sep" />
            {children}
          </>
        ) : null}
      </SubMenuGroup>
    </ContextMenuPortal>
  )
}
