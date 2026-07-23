import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import type { IdeConfig, InstalledEditor } from '../lib/types'
import { useSettingsStore } from '../stores/settingsStore'
import { IdeIcon } from './IdeIcon'
import { ModalShell } from './ModalShell'

function newIde(partial?: Partial<IdeConfig>): IdeConfig {
  return {
    id: crypto.randomUUID(),
    name: 'Custom IDE',
    executable: '',
    argsTemplate: '{path}',
    enabled: true,
    builtin: false,
    iconPath: null,
    ...partial,
  }
}

export function IdeSettingsModal() {
  const open = useSettingsStore((s) => s.ideModalOpen)
  const setIdeModalOpen = useSettingsStore((s) => s.setIdeModalOpen)
  const config = useSettingsStore((s) => s.config)
  const saveIdes = useSettingsStore((s) => s.saveIdes)
  const [draft, setDraft] = useState<IdeConfig[] | null>(null)
  const [pendingDelete, setPendingDelete] = useState<IdeConfig | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editors, setEditors] = useState<InstalledEditor[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadTarget, setUploadTarget] = useState<string | null>(null)
  const { t } = useI18n()

  useEffect(() => {
    if (!pickerOpen) return
    let cancelled = false
    setPickerLoading(true)
    void invoke<InstalledEditor[]>('list_installed_editors')
      .then((list) => {
        if (!cancelled) setEditors(list)
      })
      .catch(() => {
        if (!cancelled) setEditors([])
      })
      .finally(() => {
        if (!cancelled) setPickerLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [pickerOpen])

  if (!open) return null

  const ides = draft ?? config?.ides ?? []

  const close = () => {
    setDraft(null)
    setPendingDelete(null)
    setPickerOpen(false)
    setIdeModalOpen(false)
  }

  const update = (id: string, patch: Partial<IdeConfig>) => {
    setDraft(ides.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }

  const confirmDelete = () => {
    if (!pendingDelete) return
    setDraft(ides.filter((i) => i.id !== pendingDelete.id))
    setPendingDelete(null)
  }

  const alreadyAdded = (exe: string) =>
    ides.some((i) => i.executable.trim().toLowerCase() === exe.trim().toLowerCase())

  const extractIcon = async (executable: string): Promise<string | null> => {
    const exe = executable.trim()
    if (!exe) return null
    try {
      return await invoke<string>('extract_ide_icon_from_exe', { executable: exe })
    } catch {
      return null
    }
  }

  const addFromEditor = async (ed: InstalledEditor) => {
    if (!ed.available || alreadyAdded(ed.executable)) return
    const iconPath = await extractIcon(ed.executable)
    setDraft([
      ...ides,
      newIde({
        name: ed.name,
        executable: ed.executable,
        argsTemplate: '{path}',
        enabled: true,
        builtin: false,
        iconPath,
      }),
    ])
    setPickerOpen(false)
    setPickerQuery('')
  }

  const addBlank = () => {
    setDraft([...ides, newIde()])
    setPickerOpen(false)
    setPickerQuery('')
  }

  const addManualExe = async () => {
    const path = await invoke<string | null>('pick_executable')
    if (!path) return
    const base =
      path
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        ?.replace(/\.(exe|cmd|bat)$/i, '') ?? 'Custom IDE'
    const iconPath = await extractIcon(path)
    setDraft([
      ...ides,
      newIde({
        name: base,
        executable: path,
        iconPath,
      }),
    ])
    setPickerOpen(false)
    setPickerQuery('')
  }

  const browseExe = async (id: string) => {
    const path = await invoke<string | null>('pick_executable')
    if (!path) return
    const iconPath = await extractIcon(path)
    update(id, { executable: path, ...(iconPath ? { iconPath } : {}) })
  }

  const extractIconForIde = async (id: string, executable: string) => {
    const iconPath = await extractIcon(executable)
    if (iconPath) update(id, { iconPath })
  }

  const browseIcon = async (id: string) => {
    const path = await invoke<string | null>('pick_image')
    if (!path) return
    const cached = await invoke<string>('import_ide_icon', { sourcePath: path })
    update(id, { iconPath: cached })
  }

  const onUploadPicked = async (file: File | undefined) => {
    if (!file || !uploadTarget) return
    const ext = file.name.split('.').pop() ?? 'png'
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()))
    const cached = await invoke<string>('import_ide_icon_bytes', { bytes, ext })
    update(uploadTarget, { iconPath: cached })
    setUploadTarget(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const save = async () => {
    await saveIdes(ides)
    setDraft(null)
    setIdeModalOpen(false)
  }

  return (
    <>
      <ModalShell title={t('ide.title')} onClose={close} wide>
        <p className="muted">{t('ide.desc')}</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.ico,.svg"
          hidden
          onChange={(e) => void onUploadPicked(e.target.files?.[0])}
        />
        <div className="ide-list">
          {ides.map((ide) => (
            <div key={ide.id} className="ide-card">
              <div className="ide-card-top">
                <div className="ide-icon-edit">
                  <IdeIcon iconPath={ide.iconPath} name={ide.name} size={36} />
                  <div className="ide-icon-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void browseIcon(ide.id)}
                    >
                      {t('ide.iconBrowse')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setUploadTarget(ide.id)
                        fileRef.current?.click()
                      }}
                    >
                      {t('ide.iconUpload')}
                    </button>
                  {ide.iconPath && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => update(ide.id, { iconPath: null })}
                    >
                      {t('ide.iconClear')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    title={t('ide.iconFromExeHint')}
                    disabled={!ide.executable.trim()}
                    onClick={() => void extractIconForIde(ide.id, ide.executable)}
                  >
                    {t('ide.iconFromExe')}
                  </button>
                </div>
                </div>
                <label className="ide-field" style={{ flex: 1 }}>
                  <span className="muted">{t('ide.name')}</span>
                  <input
                    value={ide.name}
                    onChange={(e) => update(ide.id, { name: e.target.value })}
                  />
                </label>
                <div className="ide-card-actions">
                  <label className="ide-enable">
                    <input
                      type="checkbox"
                      checked={ide.enabled}
                      onChange={(e) =>
                        update(ide.id, { enabled: e.target.checked })
                      }
                    />
                    {t('ide.on')}
                  </label>
                  <button
                    type="button"
                    className="btn btn-sm danger"
                    onClick={() => setPendingDelete(ide)}
                  >
                    {t('ide.del')}
                  </button>
                </div>
              </div>
              <label className="ide-field">
                <span className="muted">{t('ide.iconPath')}</span>
                <input
                  value={ide.iconPath ?? ''}
                  placeholder={t('ide.iconPathHint')}
                  onChange={(e) =>
                    update(ide.id, { iconPath: e.target.value.trim() || null })
                  }
                  onBlur={async (e) => {
                    const v = e.target.value.trim()
                    if (!v || v.includes('ide-icons')) return
                    try {
                      const cached = await invoke<string>('import_ide_icon', {
                        sourcePath: v,
                      })
                      update(ide.id, { iconPath: cached })
                    } catch {
                      /* keep typed path */
                    }
                  }}
                />
              </label>
              <label className="ide-field">
                <span className="muted">{t('ide.executable')}</span>
                <div className="ide-exe-row">
                  <input
                    value={ide.executable}
                    onChange={(e) =>
                      update(ide.id, { executable: e.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void browseExe(ide.id)}
                  >
                    …
                  </button>
                </div>
              </label>
              <label className="ide-field">
                <span className="muted">{t('ide.args')}</span>
                <input
                  value={ide.argsTemplate}
                  onChange={(e) =>
                    update(ide.id, { argsTemplate: e.target.value })
                  }
                />
              </label>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setPickerQuery('')
              setPickerOpen(true)
            }}
          >
            {t('ide.add')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const found = await invoke<InstalledEditor[]>('list_installed_editors')
              const available = found.filter((e) => e.available)
              const next = [...ides]
              for (const ed of available) {
                if (alreadyAdded(ed.executable)) continue
                const iconPath = await extractIcon(ed.executable)
                next.push(
                  newIde({
                    name: ed.name,
                    executable: ed.executable,
                    argsTemplate: '{path}',
                    enabled: true,
                    builtin: false,
                    iconPath,
                  }),
                )
              }
              setDraft(next)
            }}
          >
            {t('ide.redetect')}
          </button>
          <button type="button" className="btn" onClick={close}>
            {t('ide.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void save()}
          >
            {t('ide.save')}
          </button>
        </div>
      </ModalShell>

      {pickerOpen && (
        <IdePickerModal
          editors={editors}
          loading={pickerLoading}
          query={pickerQuery}
          onQuery={setPickerQuery}
          alreadyAdded={alreadyAdded}
          onPick={(ed) => void addFromEditor(ed)}
          onManual={() => void addManualExe()}
          onBlank={addBlank}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {pendingDelete && (
        <ModalShell
          title={t('ide.delTitle')}
          onClose={() => setPendingDelete(null)}
        >
          <p className="muted">
            {t('ide.delConfirm', {
              name: pendingDelete.name || pendingDelete.id,
            })}
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setPendingDelete(null)}
            >
              {t('ide.cancel')}
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={confirmDelete}
            >
              {t('ide.del')}
            </button>
          </div>
        </ModalShell>
      )}
    </>
  )
}

function IdePickerModal({
  editors,
  loading,
  query,
  onQuery,
  alreadyAdded,
  onPick,
  onManual,
  onBlank,
  onClose,
}: {
  editors: InstalledEditor[]
  loading: boolean
  query: string
  onQuery: (q: string) => void
  alreadyAdded: (exe: string) => boolean
  onPick: (ed: InstalledEditor) => void
  onManual: () => void
  onBlank: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return editors
    return editors.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.executable.toLowerCase().includes(q),
    )
  }, [editors, query])

  return (
    <ModalShell title={t('ide.pickTitle')} onClose={onClose}>
      <p className="muted">{t('ide.pickHint')}</p>
      <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
        {t('ide.envHint')}
      </p>
      <input
        className="ide-pick-search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t('ide.pickSearch')}
        autoFocus
      />
      <div className="ide-pick-list">
        {loading && <div className="muted">{t('projects.scanning')}</div>}
        {!loading && filtered.length === 0 && (
          <div className="muted">{t('ide.pickEmpty')}</div>
        )}
        {!loading &&
          filtered.map((ed) => {
            const added = alreadyAdded(ed.executable)
            const disabled = !ed.available || added
            return (
              <button
                key={`${ed.name}::${ed.executable}`}
                type="button"
                className={`ide-pick-item ${disabled ? 'disabled' : ''}`}
                disabled={disabled}
                title={ed.executable}
                onClick={() => onPick(ed)}
              >
                <IdeIcon name={ed.name} size={22} />
                <span className="ide-pick-meta">
                  <span className="ide-pick-name">{ed.name}</span>
                  <span className="ide-pick-path muted">{ed.executable}</span>
                </span>
                <span className="ide-pick-badge muted">
                  {added
                    ? t('ide.pickAdded')
                    : ed.available
                      ? ''
                      : t('ide.pickUnavailable')}
                </span>
              </button>
            )
          })}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onManual}>
          {t('ide.pickManual')}
        </button>
        <button type="button" className="btn" onClick={onBlank}>
          {t('ide.pickBlank')}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t('ide.cancel')}
        </button>
      </div>
    </ModalShell>
  )
}
