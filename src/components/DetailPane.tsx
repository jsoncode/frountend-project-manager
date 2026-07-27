import { EditorShell } from './EditorShell'
import { ProjectHeader } from './ProjectHeader'
import { ResizeHandle } from './ResizeHandle'
import { TerminalPanel } from './TerminalPanel'
import { ToolWindow } from './ToolWindow'
import { useEditorStore } from '../stores/editorStore'
import { useLayoutStore } from '../stores/layoutStore'
import { useProjectStore } from '../stores/projectStore'

export function DetailPane() {
  const selected = useProjectStore((s) => s.selected)
  const hasOpenFiles = useEditorStore((s) => s.tabs.length > 0)
  const terminalHeight = useLayoutStore((s) => s.terminalHeight)
  const persist = useLayoutStore((s) => s.persist)

  return (
    <section className="detail-pane">
      <div className={`detail-body${selected ? '' : ' detail-body-empty'}`}>
        <div className={`main-col${hasOpenFiles ? '' : ' main-col-term-only'}`}>
          <div
            className={`editor-slot${hasOpenFiles ? '' : ' editor-slot-collapsed'}`}
            aria-hidden={!hasOpenFiles}
          >
            <ProjectHeader />
            <EditorShell />
          </div>
          {hasOpenFiles ? (
            <ResizeHandle
              orientation="horizontal"
              onDrag={(d) => {
                const { terminalHeight, setTerminalHeight } =
                  useLayoutStore.getState()
                setTerminalHeight(terminalHeight - d)
              }}
              onDragEnd={persist}
            />
          ) : null}
          <TerminalPanel
            height={hasOpenFiles ? terminalHeight : undefined}
            fill={!hasOpenFiles}
          />
        </div>
        <ToolWindow />
      </div>
    </section>
  )
}
