import { Settings, TerminalSquare } from 'reicon-react'
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { isTauri } from '../lib/tauri'
import { showErrorLog } from '../stores/errorLogStore'
import { useSettingsStore } from '../stores/settingsStore'
import { ModalShell } from './ModalShell'
import { Tooltip } from './Tooltip'

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

type KvRow = {
  id: string
  key: string
  value: string
}

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

const DEFAULT_PARAM_SEED: { key: string; value: string }[] = [
  { key: 'branch', value: 'uat5' },
  { key: 'NodeVersion', value: 'v24.12.0' },
  { key: 'INSTALL_COMMAND_ACTIVE', value: 'pnpm i' },
  { key: 'BUILD_COMMAND_ACTIVE', value: 'pnpm build:uat' },
  { key: 'project', value: '' },
]

function newId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function serversToRows(servers: JenCliState['servers']): ServerRow[] {
  const map = servers.servers ?? {}
  return Object.entries(map).map(([alias, s]) => ({
    alias,
    baseUrl: s.baseUrl ?? '',
    username: s.username ?? '',
    apiToken: s.apiToken ?? '',
  }))
}

function rowsToServersJson(
  defaultServer: string,
  rows: ServerRow[],
): JenCliState['servers'] {
  const servers: Record<
    string,
    { baseUrl: string; username: string; apiToken: string }
  > = {}
  for (const r of rows) {
    const alias = r.alias.trim()
    if (!alias) continue
    servers[alias] = {
      baseUrl: r.baseUrl.trim(),
      username: r.username.trim(),
      apiToken: r.apiToken.trim(),
    }
  }
  const aliases = Object.keys(servers)
  return {
    defaultServer:
      defaultServer.trim() && servers[defaultServer.trim()]
        ? defaultServer.trim()
        : aliases[0] || 'tx',
    servers,
  }
}

/** Flatten legacy role→name + role→default into editable Jenkins key/value rows. */
function defaultsToKvRows(defaults: JenCliState['defaults']): KvRow[] {
  const pk = defaults.paramKeys ?? {}
  const pd = defaults.paramDefaults ?? {}
  const roles = [...new Set([...Object.keys(pk), ...Object.keys(pd)])]
  if (roles.length === 0) {
    return DEFAULT_PARAM_SEED.map((s) => ({ id: newId(), ...s }))
  }
  return roles.map((role) => ({
    id: newId(),
    key: (pk[role] && pk[role].trim()) || role,
    value: pd[role] != null ? String(pd[role]) : '',
  }))
}

function kvRowsToParamDefaults(rows: KvRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    const k = r.key.trim()
    if (!k) continue
    out[k] = r.value
  }
  return out
}

type ServersManageProps = {
  initial: JenCliState['servers']
  exampleJson: string
  configPath: string
  onClose: () => void
  onSaved: () => void | Promise<void>
}

function JenCliServersManageModal({
  initial,
  exampleJson,
  configPath,
  onClose,
  onSaved,
}: ServersManageProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [defaultServer, setDefaultServer] = useState(
    initial.defaultServer ?? 'tx',
  )
  const [rows, setRows] = useState<ServerRow[]>(() => serversToRows(initial))
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(initial, null, 2),
  )
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const aliases = useMemo(
    () => rows.map((r) => r.alias.trim()).filter(Boolean),
    [rows],
  )

  const syncJsonFromForm = () => {
    const payload = rowsToServersJson(defaultServer, rows)
    setJsonText(JSON.stringify(payload, null, 2))
    setJsonError(null)
  }

  const applyJsonToForm = (): boolean => {
    try {
      const parsed = JSON.parse(jsonText) as JenCliState['servers']
      if (!parsed || typeof parsed !== 'object') {
        setJsonError(t('jenCli.jsonInvalid'))
        return false
      }
      if (!parsed.servers || typeof parsed.servers !== 'object') {
        setJsonError(t('jenCli.jsonNeedServers'))
        return false
      }
      setRows(serversToRows(parsed))
      setDefaultServer(parsed.defaultServer ?? Object.keys(parsed.servers)[0] ?? 'tx')
      setJsonError(null)
      return true
    } catch (e) {
      setJsonError(String(e))
      return false
    }
  }

  const save = async () => {
    let payload: JenCliState['servers']
    if (mode === 'json') {
      if (!applyJsonToForm()) return
      try {
        payload = JSON.parse(jsonText) as JenCliState['servers']
      } catch {
        return
      }
      if (!payload.servers || typeof payload.servers !== 'object') {
        setJsonError(t('jenCli.jsonNeedServers'))
        return
      }
    } else {
      payload = rowsToServersJson(defaultServer, rows)
    }
    setSaving(true)
    try {
      await invoke('jen_cli_save_servers', { servers: payload })
      await onSaved()
      onClose()
    } catch (e) {
      showErrorLog(e)
    } finally {
      setSaving(false)
    }
  }

  const resetExample = async () => {
    setSaving(true)
    try {
      const v = await invoke<JenCliState['servers']>('jen_cli_reset_servers')
      setRows(serversToRows(v))
      setDefaultServer(v.defaultServer ?? 'tx')
      setJsonText(JSON.stringify(v, null, 2))
      setJsonError(null)
      await onSaved()
    } catch (e) {
      showErrorLog(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title={t('jenCli.serversManageTitle')}
      onClose={onClose}
      wide
      nested
      className="jen-cli-servers-modal"
      closeOnEsc={!saving}
      footer={
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            disabled={saving}
            onClick={() => void resetExample()}
          >
            {t('jenCli.resetExample')}
          </button>
          <button type="button" className="btn" disabled={saving} onClick={onClose}>
            {t('branch.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? t('jenCli.saving') : t('jenCli.saveServers')}
          </button>
        </div>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        {t('jenCli.serversHint')}
      </p>
      <div className="jen-cli-mode-tabs">
        <button
          type="button"
          className={`btn btn-sm${mode === 'form' ? ' primary' : ''}`}
          onClick={() => {
            if (mode === 'json') applyJsonToForm()
            setMode('form')
          }}
        >
          {t('jenCli.serversModeForm')}
        </button>
        <button
          type="button"
          className={`btn btn-sm${mode === 'json' ? ' primary' : ''}`}
          onClick={() => {
            if (mode === 'form') syncJsonFromForm()
            setMode('json')
          }}
        >
          {t('jenCli.serversModeJson')}
        </button>
      </div>

      {mode === 'form' && (
        <>
          <label className="field-label">
            {t('jenCli.defaultServer')}
            <select
              className="input-block"
              value={defaultServer}
              onChange={(e) => setDefaultServer(e.target.value)}
            >
              {aliases.length === 0 ? (
                <option value="">{t('jenCli.serversEmpty')}</option>
              ) : (
                aliases.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))
              )}
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
          <button
            type="button"
            className="btn btn-sm"
            style={{ marginTop: 8 }}
            onClick={() =>
              setRows((rs) => [
                ...rs,
                { alias: '', baseUrl: '', username: '', apiToken: '' },
              ])
            }
          >
            {t('jenCli.addServer')}
          </button>
        </>
      )}

      {mode === 'json' && (
        <>
          <p className="muted">{t('jenCli.serversJsonHint')}</p>
          <textarea
            className="jen-cli-json-editor user-select-text"
            spellCheck={false}
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value)
              setJsonError(null)
            }}
            rows={16}
          />
          {jsonError && <div className="status-banner dirty">{jsonError}</div>}
          <details className="jen-cli-example-details">
            <summary>{t('jenCli.showExample')}</summary>
            <pre className="jen-cli-example user-select-text">{exampleJson}</pre>
          </details>
        </>
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        {t('jenCli.configPath', { path: configPath })}
      </p>
    </ModalShell>
  )
}

type JenCliSettingsModalProps = {
  inline?: boolean
  onClosePanel?: () => void
}

export function JenCliSettingsModal({ inline, onClosePanel }: JenCliSettingsModalProps = {}) {
  const storeOpen = useSettingsStore((s) => s.jenCliModalOpen)
  const setOpen = useSettingsStore((s) => s.setJenCliModalOpen)
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<JenCliState | null>(null)
  const [defaultServer, setDefaultServer] = useState('tx')
  const [cliJob, setCliJob] = useState('')
  const [cliInterval, setCliInterval] = useState(3000)
  const [cliConsole, setCliConsole] = useState(true)
  const [paramRows, setParamRows] = useState<KvRow[]>([])
  const [pathEnabled, setPathEnabled] = useState(false)
  const [serversOpen, setServersOpen] = useState(false)

  const isOpen = inline || storeOpen

  const reload = useCallback(async () => {
    if (!isTauri()) return
    setLoading(true)
    setError(null)
    try {
      const s = await invoke<JenCliState>('jen_cli_get_state')
      setState(s)
      const ds =
        s.servers.defaultServer ??
        s.defaults.cliDefaults?.server ??
        Object.keys(s.servers.servers ?? {})[0] ??
        'tx'
      setDefaultServer(ds)
      setCliJob(s.defaults.cliDefaults?.job ?? '')
      setCliInterval(s.defaults.cliDefaults?.intervalMs ?? 3000)
      setCliConsole(s.defaults.cliDefaults?.console !== false)
      setParamRows(defaultsToKvRows(s.defaults))
      setPathEnabled(s.pathEnabled)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      setServersOpen(false)
      void reload()
    }
  }, [isOpen, reload])

  const aliases = useMemo(
    () => Object.keys(state?.servers.servers ?? {}),
    [state],
  )

  const selectDefaultServer = async (alias: string) => {
    if (!state) return
    setDefaultServer(alias)
    const next = {
      ...state.servers,
      defaultServer: alias,
      servers: state.servers.servers ?? {},
    }
    setSaving(true)
    try {
      await invoke('jen_cli_save_servers', { servers: next })
      // Keep cliDefaults.server in sync.
      await invoke('jen_cli_save_defaults', {
        defaults: {
          ...state.defaults,
          cliDefaults: {
            ...(state.defaults.cliDefaults ?? {}),
            server: alias,
            job: cliJob.trim(),
            intervalMs: Number(cliInterval) || 3000,
            console: cliConsole,
          },
        },
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
      const paramDefaults = kvRowsToParamDefaults(paramRows)
      await invoke('jen_cli_save_defaults', {
        defaults: {
          ...state.defaults,
          cliDefaults: {
            server: defaultServer.trim(),
            job: cliJob.trim(),
            intervalMs: Number(cliInterval) || 3000,
            console: cliConsole,
          },
          // Flattened: key is the Jenkins param name; no separate role map.
          paramKeys: {},
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

  const handleClose = () => {
    if (inline) {
      onClosePanel?.()
    } else {
      setOpen(false)
    }
  }

  if (!isOpen) return null

  const content = (
    <>
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
              <p className="muted">{t('jenCli.serverSelectHint')}</p>
              <div className="jen-cli-server-select-row">
                <select
                  className="input-block"
                  value={defaultServer}
                  disabled={saving || aliases.length === 0}
                  onChange={(e) => void selectDefaultServer(e.target.value)}
                >
                  {aliases.length === 0 ? (
                    <option value="">{t('jenCli.serversEmpty')}</option>
                  ) : (
                    aliases.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))
                  )}
                </select>
                <Tooltip title={t('jenCli.manageServers')}>
                  <button
                    type="button"
                    className="btn btn-sm jen-cli-server-gear"
                    aria-label={t('jenCli.manageServers')}
                    onClick={() => setServersOpen(true)}
                  >
                    <Settings
                      className="ui-icon"
                      size={14}
                      color="currentColor"
                      aria-hidden
                    />
                  </button>
                </Tooltip>
              </div>
            </section>

            <section className="settings-section">
              <h4>{t('jenCli.cliDefaultsTitle')}</h4>
              <p className="muted">{t('jenCli.cliDefaultsHint')}</p>
              <div className="jen-cli-grid">
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

              <h4 style={{ marginTop: 16 }}>{t('jenCli.paramDefaultsTitle')}</h4>
              <p className="muted">{t('jenCli.paramDefaultsHint')}</p>
              <div className="jen-cli-kv-head">
                <span>{t('jenCli.paramKeyCol')}</span>
                <span>{t('jenCli.paramValueCol')}</span>
                <span />
              </div>
              <div className="jen-cli-kv-list">
                {paramRows.map((row) => (
                  <div key={row.id} className="jen-cli-kv-row">
                    <input
                      className="input-block"
                      placeholder="key"
                      value={row.key}
                      onChange={(e) => {
                        const v = e.target.value
                        setParamRows((rs) =>
                          rs.map((r) =>
                            r.id === row.id ? { ...r, key: v } : r,
                          ),
                        )
                      }}
                    />
                    <input
                      className="input-block"
                      placeholder="value"
                      value={row.value}
                      onChange={(e) => {
                        const v = e.target.value
                        setParamRows((rs) =>
                          rs.map((r) =>
                            r.id === row.id ? { ...r, value: v } : r,
                          ),
                        )
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm danger"
                      onClick={() =>
                        setParamRows((rs) => rs.filter((r) => r.id !== row.id))
                      }
                    >
                      {t('jenCli.removeParam')}
                    </button>
                  </div>
                ))}
              </div>
              <div className="modal-actions" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    setParamRows((rs) => [
                      ...rs,
                      { id: newId(), key: '', value: '' },
                    ])
                  }
                >
                  {t('jenCli.addParam')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    setParamRows(
                      DEFAULT_PARAM_SEED.map((s) => ({ id: newId(), ...s })),
                    )
                  }
                >
                  {t('jenCli.resetParams')}
                </button>
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
    </>
  )

  const contentFooter = (
    <div className="modal-actions">
      <button type="button" className="btn" onClick={handleClose}>
        {t('settings.close')}
      </button>
    </div>
  )

  if (inline) {
    return (
      <>
        <div className="settings-inline-panel">
          {content}
          {contentFooter}
        </div>
        {serversOpen && state && (
          <JenCliServersManageModal
            initial={state.servers}
            exampleJson={state.exampleServersJson}
            configPath={state.paths.serversConfig}
            onClose={() => setServersOpen(false)}
            onSaved={reload}
          />
        )}
      </>
    )
  }

  return (
    <>
      <ModalShell
        title={t('jenCli.title')}
        onClose={handleClose}
        wide
        elevated
        className="jen-cli-settings-modal"
        footer={contentFooter}
      >
        {content}
      </ModalShell>

      {serversOpen && state && (
        <JenCliServersManageModal
          initial={state.servers}
          exampleJson={state.exampleServersJson}
          configPath={state.paths.serversConfig}
          onClose={() => setServersOpen(false)}
          onSaved={reload}
        />
      )}
    </>
  )
}

/** Icon export helper for Settings entry — keeps import paths stable. */
export function JenCliSettingsIcon() {
  return (
    <TerminalSquare className="ui-icon" size={15} color="currentColor" aria-hidden />
  )
}
