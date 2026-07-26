import { EditorShell } from './EditorShell'
import { ProjectHeader } from './ProjectHeader'
import { ResizeHandle } from './ResizeHandle'
import { TerminalPanel } from './TerminalPanel'
import { ToolWindow } from './ToolWindow'
import { useLayoutStore } from '../stores/layoutStore'
import { useProjectStore } from '../stores/projectStore'

export function DetailPane() {
  const selected = useProjectStore((s) => s.selected)
  const terminalHeight = useLayoutStore((s) => s.terminalHeight)
  const persist = useLayoutStore((s) => s.persist)

  return (
    <section className="detail-pane">
      <div className={`detail-body${selected ? '' : ' detail-body-empty'}`}>
        <div className="main-col">
          <div className="editor-slot">
            <ProjectHeader />
            <EditorShell />
          </div>
          <ResizeHandle
            orientation="horizontal"
            onDrag={(d) => {
              const { terminalHeight, setTerminalHeight } =
                useLayoutStore.getState()
              setTerminalHeight(terminalHeight - d)
            }}
            onDragEnd={persist}
          />
          <TerminalPanel height={terminalHeight} />
        </div>
        <ToolWindow />
      </div>
    </section>
  )
}
