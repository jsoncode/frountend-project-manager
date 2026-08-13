import { Dropdown, type MenuProps } from 'antd'
import { useI18n } from '../i18n/useI18n'
import { addExistingWorkspace } from '../lib/workspaceActions'
import { showErrorLog } from '../stores/errorLogStore'
import { useWorkspaceUiStore } from '../stores/workspaceUiStore'

/** VS Code–style File menu inside the custom title bar (antd Dropdown). */
export function TitleFileMenu() {
  const { t } = useI18n()
  const openNewWorkspace = useWorkspaceUiStore((s) => s.openNewWorkspace)

  const items: MenuProps['items'] = [
    {
      key: 'add',
      label: t('menu.addWorkspace'),
      onClick: () => {
        void addExistingWorkspace().catch(showErrorLog)
      },
    },
    {
      key: 'new',
      label: t('menu.newWorkspace'),
      onClick: () => {
        openNewWorkspace()
      },
    },
  ]

  return (
    <Dropdown menu={{ items }} trigger={['click']} placement="bottomLeft">
      <button type="button" className="title-menu-btn">
        {t('menu.file')}
      </button>
    </Dropdown>
  )
}
