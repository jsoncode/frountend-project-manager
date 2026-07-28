import { TerminalSquare } from 'reicon-react'
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { isTauri } from '../lib/tauri'
import { showErrorLog } from '../stores/errorLogStore'
import { useSettingsStore } from '../stores/settingsStore'
import { ModalShell } from './ModalShell'

type JenCliState = {
  paths: {
    shimDir: string
    serversConfig: string
    defaultsConfig: string
  }
  servers: {
    defaultServer?: string
    servers?: Record<
      string,
      { baseUrl?: string; username?: string; apiToken?: string }
    >
  }
  defaults: {
    cliDefaults?: {
      server?: string
      job?: string
      intervalMs?: number
      console?: boolean
    }
    paramKeys?: Record<string, string>
    paramDefaults?: Record<string, string>
  }
  exampleServersJson: string
  pathEnabled: boolean
  nodeOk: boolean
  nodeVersion?: string | null
}

type ServerRow = {
  alias: string
  baseUrl: string
  username: string
  apiToken: string
}

const PARAM_ROLES = [
  'branch',
  'nodeVersion',
  'installCommand',
  'buildCommand',
  'project',
] as const

const CLI_DOCS = [
  {
    flag: 'run',
    usage: 'jen-cli run [--server] [--job] [--params] [--param]',
    example: 'jen-cli run --server tx --params "branch=uat5"',
  },
  {
    flag: 'list / ls / l',
    usage: 'jen-cli list --key <paramName>',
    example: 'jen-cli list --key branch',
  },
  {
    flag: 'lp / ln',
    usage: 'jen-cli lp | jen-cli ln',
    example: 'jen-cli lp',
  },
  {
    flag: '--config',
    usage: '--config <path>',
    example: '--config D:\\cfg\\jenkins.config.json',
  },
  {
    flag: '--server',
    usage: '--server <alias>',
    example: '--server tx',
  },
  {
    flag: '--job',
    usage: '--job <name>',
    example: '--job system3_Front_docker3',
  },
  {
    flag: '--params',
    usage: '--params "k=v,a=b"',
    example: '--params "branch=uat5,NodeVersion=24"',
  },
  {
    flag: '--param',
    usage: '--param k=v (可重复)',
    example: '--param branch=uat5',
  },
  {
    flag: '--key / -k',
    usage: 'list 时查看的参数名',
    example: '--key NodeVersion',
  },
  {
    flag: '--no-console',
    usage: '仅打印状态，不打印日志',
    example: 'jen-cli run --no-console',
  },
  {
    flag: '--interval',
    usage: '--interval <ms>',
    example: '--interval 3000',
  },
] as const

function serversToRows(servers: JenCliState['servers']): ServerRow[] {
  const map = servers.servers ?? {}
  return Object.entries(map).map(([alias, s]) => ({
    alias,
    baseUrl: s.baseUrl ?? '',
    username: s.username ?? '',
    apiToken: s.apiToken ?? '',
  }))
}

export function JenCliSettingsModal() {
  const open = useSettingsStore((s) => s.jenCliModalOpen)
  const setOpen = useSettingsStore((s) => s.setJenCliModalOpen)
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<JenCliState | null>(null)
  const [defaultServer, setDefaultServer] = useState('tx')
  const [rows, setRows] = useState<ServerRow[]>([])
  const [cliServer, setCliServer] = useState('tx')
  const [cliJob, setCliJob] = useState('')
  const [cliInterval, setCliInterval] = useState(3000)
  const [cliConsole, setCliConsole] = useState(true)
  const [paramKeys, setParamKeys] = useState<Record<string, string>>({})
  const [paramDefaults, setParamDefaults] = useState<Record<string, string>>({})
  const [pathEnabled, setPathEnabled] = useState(false)
  const [showExample, setShowExample] = useState(false)

  const reload = useCallback(async () => {
    if (!isTauri()) return
    setLoading(true)
    setError(null)
    try {
      const s = await invoke<JenCliState>('jen_cli_get_state')
      setState(s)
      setDefaultServer(s.servers.defaultServer ?? 'tx')
      setRows(serversToRows(s.servers))
      setCliServer(s.defaults.cliDefaults?.server ?? 'tx')
      setCliJob(s.defaults.cliDefaults?.job ?? '')
      setCliInterval(s.defaults.cliDefaults?.intervalMs ?? 3000)
      setCliConsole(s.defaults.cliDefaults?.console !== false)
      setParamKeys({ ...(s.defaults.paramKeys ?? {}) })
      setParamDefaults({ ...(s.defaults.paramDefaults ?? {}) })
      setPathEnabled(s.pathEnabled)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void reload()
  }, [open, reload])

  const aliases = useMemo(() => rows.map((r) => r.alias).filter(Boolean), [rows])

  const saveServers = async () => {
    const servers: Record<string, { baseUrl: string; username: string; apiToken: string }> =
      {}
    for (const r of rows) {
      const alias = r.alias.trim()
      if (!alias) continue
      servers[alias] = {
        baseUrl: r.baseUrl.trim(),
        username: r.username.trim(),
        apiToken: r.apiToken.trim(),
      }
    }
    setSaving(true)
    try {
      await invoke('jen_cli_save_servers', {
        servers: { defaultServer: defaultServer.trim() || aliases[0] || 'tx', servers },
      })
      await reload()
    } catch (e) {
      showErrorLog(e)
    } finally {
      setSaving(false)
    }
  }

  const saveDefaults = async () => {
    if (!state) return
    setSaving(true)
    try {
      await invoke('jen_cli_save_defaults', {
        defaults: {
          ...state.defaults,
          cliDefaults: {
            server: cliServer.trim(),
            job: cliJob.trim(),
            intervalMs: Number(cliInterval) || 3000,
            console: cliConsole,
          },
          paramKeys,
          paramDefaults,
        },
      })
      await reload()
    } catch (e) {
      showErrorLog(e)
    } finally {
      setSaving(false)
    }
  }

  const togglePath = async (enabled: boolean) => {
    setSaving(true)
    try {
      await invoke('jen_cli_set_path_enabled', { enabled })
      setPathEnabled(enabled)
    } catch (e) {
      showErrorLog(e)
    } finally {
      setSaving(false)
    }
  }

  const resetServers = async () => {
    setSaving(true)
    try {
      await invoke('jen_cli_reset_servers')
      await reload()
    } catch (e) {
      showErrorLog(e)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <ModalShell
      title={t('jenCli.title')}
      onClose={() => setOpen(false)}
      wide
      elevated
      className="jen-cli-settings-modal"
    >
      {loading && <p className="muted">{t('jenCli.loading')}</p>}
      {error && <div className="status-banner dirty">{error}</div>}

      {!loading && state && (
        <>
          {!state.nodeOk && (
            <div className="status-banner dirty" style={{ marginBottom: 12 }}>
              {t('jenCli.nodeMissing')}
            </div>
          )}
          {state.nodeOk && (
            <p className="muted" style={{ marginTop: 0 }}>
              {t('jenCli.nodeOk', { version: state.nodeVersion ?? '' })}
            </p>
          )}

          <section className="settings-section">
            <h4>{t('jenCli.serversTitle')}</h4>
            <p className="muted">{t('jenCli.serversHint')}</p>
            <label className="field-label">
              {t('jenCli.defaultServer')}
              <select
                className="input-block"
                value={defaultServer}
                onChange={(e) => setDefaultServer(e.target.value)}
              >
                {aliases.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <div className="jen-cli-server-list">
              {rows.map((row, idx) => (
                <div key={idx} className="jen-cli-server-card">
                  <input
                    className="input-block"
                    placeholder="alias"
                    value={row.alias}
                    onChange={(e) => {
                      const v = e.target.value
                      setRows((rs) =>
                        rs.map((r, i) => (i === idx ? { ...r, alias: v } : r)),
                      )
                    }}
                  />
                  <input
                    className="input-block"
                    placeholder="baseUrl"
                    value={row.baseUrl}
                    onChange={(e) => {
                      const v = e.target.value
                      setRows((rs) =>
                        rs.map((r, i) => (i === idx ? { ...r, baseUrl: v } : r)),
                      )
                    }}
                  />
                  <input
                    className="input-block"
                    placeholder="username"
                    value={row.username}
                    onChange={(e) => {
                      const v = e.target.value
                      setRows((rs) =>
                        rs.map((r, i) => (i === idx ? { ...r, username: v } : r)),
                      )
                    }}
                  />
                  <input
                    className="input-block"
                    placeholder="apiToken"
                    type="password"
                    value={row.apiToken}
                    onChange={(e) => {
                      const v = e.target.value
                      setRows((rs) =>
                        rs.map((r, i) => (i === idx ? { ...r, apiToken: v } : r)),
                      )
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm danger"
                    onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}
                  >
                    {t('jenCli.removeServer')}
                  </button>
                </div>
              ))}
            </div>
            <div className="modal-actions" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  setRows((rs) => [
                    ...rs,
                    { alias: '', baseUrl: '', username: '', apiToken: '' },
                  ])
                }
              >
                {t('jenCli.addServer')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void resetServers()}
                disabled={saving}
              >
                {t('jenCli.resetExample')}
              </button>
              <button
                type="button"
                className="btn btn-sm primary"
                onClick={() => void saveServers()}
                disabled={saving}
              >
                {t('jenCli.saveServers')}
              </button>
            </div>
            <button
              type="button"
              className="btn btn-sm"
              style={{ marginTop: 8 }}
              onClick={() => setShowExample((v) => !v)}
            >
              {showExample ? t('jenCli.hideExample') : t('jenCli.showExample')}
            </button>
            {showExample && (
              <pre className="jen-cli-example user-select-text">{state.exampleServersJson}</pre>
            )}
            <p className="muted" style={{ fontSize: 12 }}>
              {t('jenCli.configPath', { path: state.paths.serversConfig })}
            </p>
          </section>

          <section className="settings-section">
            <h4>{t('jenCli.cliDefaultsTitle')}</h4>
            <p className="muted">{t('jenCli.cliDefaultsHint')}</p>
            <div className="jen-cli-grid">
              <label className="field-label">
                --server
                <input
                  className="input-block"
                  value={cliServer}
                  onChange={(e) => setCliServer(e.target.value)}
                />
              </label>
              <label className="field-label">
                --job
                <input
                  className="input-block"
                  value={cliJob}
                  onChange={(e) => setCliJob(e.target.value)}
                />
              </label>
              <label className="field-label">
                --interval
                <input
                  className="input-block"
                  type="number"
                  value={cliInterval}
                  onChange={(e) => setCliInterval(Number(e.target.value))}
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={cliConsole}
                  onChange={(e) => setCliConsole(e.target.checked)}
                />
                {t('jenCli.consoleDefault')}
              </label>
            </div>

            <h4 style={{ marginTop: 16 }}>{t('jenCli.paramKeysTitle')}</h4>
            <p className="muted">{t('jenCli.paramKeysHint')}</p>
            <div className="jen-cli-grid">
              {PARAM_ROLES.map((role) => (
                <label key={role} className="field-label">
                  {role} →
                  <input
                    className="input-block"
                    value={paramKeys[role] ?? role}
                    onChange={(e) =>
                      setParamKeys((m) => ({ ...m, [role]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>

            <h4 style={{ marginTop: 16 }}>{t('jenCli.paramDefaultsTitle')}</h4>
            <div className="jen-cli-grid">
              {PARAM_ROLES.map((role) => (
                <label key={role} className="field-label">
                  {role}
                  <input
                    className="input-block"
                    value={paramDefaults[role] ?? ''}
                    onChange={(e) =>
                      setParamDefaults((m) => ({ ...m, [role]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            <div className="modal-actions" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-sm primary"
                disabled={saving}
                onClick={() => void saveDefaults()}
              >
                {t('jenCli.saveDefaults')}
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h4>{t('jenCli.docsTitle')}</h4>
            <div className="jen-cli-docs">
              {CLI_DOCS.map((d) => (
                <div key={d.flag} className="jen-cli-doc-row">
                  <div className="jen-cli-doc-flag">{d.flag}</div>
                  <code>{d.usage}</code>
                  <code className="muted">{d.example}</code>
                </div>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <h4>{t('jenCli.pathTitle')}</h4>
            <p className="muted">{t('jenCli.pathHint')}</p>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={pathEnabled}
                disabled={saving}
                onChange={(e) => void togglePath(e.target.checked)}
              />
              {t('jenCli.pathEnable')}
            </label>
            <p className="muted" style={{ fontSize: 12 }}>
              {t('jenCli.shimPath', { path: state.paths.shimDir })}
            </p>
          </section>
        </>
      )}

      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          {t('settings.close')}
        </button>
      </div>
    </ModalShell>
  )
}

/** Icon export helper for Settings entry — keeps import paths stable. */
export function JenCliSettingsIcon() {
  return <TerminalSquare className="ui-icon" size={15} color="currentColor" aria-hidden />
}
