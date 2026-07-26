import { ArrowDown, ArrowUp, BranchDown } from 'reicon-react'
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
  const languages = details?.languages ?? []

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
            {meta?.label ?? fw}
          </span>
        )
      })}
      {languages.map((lang) => (
        <span key={lang} className="badge">
          {lang}
        </span>
      ))}
      <span className="badge btn-with-icon" style={{ marginLeft: 'auto', color: 'var(--cyan)' }}>
        {git?.current ? (
          <>
            <BranchDown className="ui-icon" size={12} color="currentColor" aria-hidden />
            {git.current}
            {(() => {
              const cur = (git.branches ?? []).find((b) => b.name === git.current)
              if (!cur) return null
              return (
                <>
                  {cur.behind > 0 && (
                    <span className="branch-badge behind" style={{ marginLeft: 6 }}>
                      <ArrowDown className="inline-icon" size={10} color="currentColor" aria-hidden />
                      {cur.behind}
                    </span>
                  )}
                  {cur.ahead > 0 && (
                    <span className="branch-badge ahead" style={{ marginLeft: 4 }}>
                      <ArrowUp className="inline-icon" size={10} color="currentColor" aria-hidden />
                      {cur.ahead}
                    </span>
                  )}
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
