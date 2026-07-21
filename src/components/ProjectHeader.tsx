import { useI18n } from '../i18n/useI18n'
import { FRAMEWORK_META } from '../lib/frameworks'
import { useProjectStore } from '../stores/projectStore'

export function ProjectHeader() {
  const selected = useProjectStore((s) => s.selected)
  const details = useProjectStore((s) => s.details)
  const git = useProjectStore((s) => s.git)
  const { t } = useI18n()

  if (!selected) return null

  const frameworks = details?.summary.frameworks ?? selected.frameworks

  return (
    <div className="detail-header">
      <h1>{selected.folderName}</h1>
      {selected.pkgName && <span className="badge">{selected.pkgName}</span>}
      {selected.pkgVersion && <span className="badge">v{selected.pkgVersion}</span>}
      {frameworks.map((fw) => {
        const meta = FRAMEWORK_META[fw]
        return (
          <span
            key={fw}
            className="badge"
            style={{ borderColor: meta?.color ?? undefined, color: meta?.color }}
          >
            {meta?.glyph ?? ''} {meta?.label ?? fw}
          </span>
        )
      })}
      <span className="badge" style={{ marginLeft: 'auto', color: 'var(--cyan)' }}>
        {git?.current ? (
          <>
            {git.current}
            {(() => {
              const cur = (git.branches ?? []).find((b) => b.name === git.current)
              if (!cur) return ' ●'
              return (
                <>
                  {cur.behind > 0 && (
                    <span className="branch-badge behind" style={{ marginLeft: 6 }}>
                      ↓{cur.behind}
                    </span>
                  )}
                  {cur.ahead > 0 && (
                    <span className="branch-badge ahead" style={{ marginLeft: 4 }}>
                      ↑{cur.ahead}
                    </span>
                  )}
                  {cur.behind === 0 && cur.ahead === 0 ? ' ●' : ''}
                </>
              )
            })()}
          </>
        ) : (
          t('header.noGit')
        )}
      </span>
    </div>
  )
}
