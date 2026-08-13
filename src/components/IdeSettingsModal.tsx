import {
  Add,
  CodeScan,
  Document,
  FolderOpen,
  Loader,
  Refresh,
  Trash,
  Upload,
  X,
} from 'reicon-react'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import type { IdeConfig, InstalledEditor } from '../lib/types'
import { showErrorLog } from '../stores/errorLogStore'
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

type IdeSettingsModalProps = {
  inline?: boolean
  onClosePanel?: () => void
}

export function IdeSettingsModal({ inline, onClosePanel }: IdeSettingsModalProps = {}) {
  const storeOpen = useSettingsStore((s) => s.ideModalOpen)
  const setIdeModalOpen = useSettingsStore((s) => s.setIdeModalOpen)
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen)
  const config = useSettingsStore((s) => s.config)
  const saveIdes = useSettingsStore((s) => s.saveIdes)
  const [draft, setDraft] = useState<IdeConfig[] | null>(null)
  const [pendingDelete, setPendingDelete] = useState<IdeConfig | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editors, setEditors] = useState<InstalledEditor[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadTarget, setUploadTarget] = useState<string | null>(null)
  const { t } = useI18n()

  const isOpen = inline || storeOpen

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

  if (!isOpen) return null

  const ides = draft ?? config?.ides ?? []

  const close = () => {
    setDraft(null)
    setPendingDelete(null)
    setPickerOpen(false)
    if (inline) {
      onClosePanel?.()
    } else {
      setIdeModalOpen(false)
    }
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

  const scanAndAddInstalled = async () => {
    if (scanning) return
    setScanning(true)
    try {
      const found = await invoke<InstalledEditor[]>('list_installed_editors')
      const available = found.filter((e) => e.available)
      const next = [...ides]
      const known = new Set(
        next.map((i) => i.executable.trim().toLowerCase()),
      )
      for (const ed of available) {
        const key = ed.executable.trim().toLowerCase()
        if (known.has(key)) continue
        known.add(key)
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
    } catch (e) {
      showErrorLog(e)
    } finally {
      setScanning(false)
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

  // Validate a path the user typed into the picker search box and add it.
  const addFromTypedPath = async (path: string) => {
    const trimmed = path.trim()
    if (!trimmed) return
    if (alreadyAdded(trimmed)) return
    try {
      const ed = await invoke<InstalledEditor | null>(
        'resolve_typed_executable',
        { path: trimmed },
      )
      if (!ed) {
        showErrorLog(t('ide.pickPathInvalid'))
        return
      }
      await addFromEditor(ed)
    } catch (e) {
      showErrorLog(e)
    }
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

  /** Folder containing the configured executable — used as dialog start dir. */
  const exeDirOf = (executable: string): string | undefined => {
    const dir = executable
      .trim()
      .replace(/\\/g, '/')
      .split('/')
      .slice(0, -1)
      .join('/')
    return dir || undefined
  }

  const browseExe = async (id: string, executable: string) => {
    // Open File Explorer right at the folder of the exe in the input —
    // same precise behavior as the project menu "Reveal in File Manager".
    void id
    const exe = executable.trim()
    if (!exe) return
    try {
      // Reveal the exe itself when it exists (Explorer highlights it);
      // fall back to opening its folder otherwise.
      try {
        await invoke('reveal_in_file_manager', { path: exe })
      } catch {
        const dir = exeDirOf(exe)
        if (!dir) throw new Error(exe)
        await invoke('reveal_in_file_manager', { path: dir })
      }
    } catch (e) {
      showErrorLog(e)
    }
  }

  const extractIconForIde = async (id: string, executable: string) => {
    const iconPath = await extractIcon(executable)
    if (iconPath) update(id, { iconPath })
  }

  const browseIcon = async (id: string, ide: IdeConfig) => {
    // Open File Explorer at the relevant folder: the icon's own folder when
    // one is configured, otherwise the exe's folder.
    void id
    const target =
      exeDirOf(ide.iconPath ?? '') ?? exeDirOf(ide.executable)
    if (!target) return
    try {
      await invoke('reveal_in_file_manager', { path: target })
    } catch (e) {
      showErrorLog(e)
    }
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
    if (inline) {
      // Inline panel lives inside the Settings modal — close it on save.
      setSettingsOpen(false)
    } else {
      setIdeModalOpen(false)
    }
  }

  const content = (
    <>
      {!inline && <p className="muted">{t('ide.desc')}</p>}
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
                      className="btn btn-sm btn-with-icon"
                      onClick={() => void browseIcon(ide.id, ide)}
                    >
                      <FolderOpen className="ui-icon" size={12} color="currentColor" aria-hidden />
                      {t('open.inFileManager')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-with-icon"
                      onClick={() => {
                        setUploadTarget(ide.id)
                        fileRef.current?.click()
                      }}
                    >
                      <Upload className="ui-icon" size={12} color="currentColor" aria-hidden />
                      {t('ide.iconUpload')}
                    </button>
                  {ide.iconPath && (
                    <button
                      type="button"
                      className="btn btn-sm btn-with-icon"
                      onClick={() => update(ide.id, { iconPath: null })}
                    >
                      <X className="ui-icon" size={12} color="currentColor" aria-hidden />
                      {t('ide.iconClear')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-with-icon"
                    title={t('ide.iconFromExeHint')}
                    disabled={!ide.executable.trim()}
                    onClick={() => void extractIconForIde(ide.id, ide.executable)}
                  >
                    <CodeScan className="ui-icon" size={12} color="currentColor" aria-hidden />
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
                    className="btn btn-sm danger btn-with-icon"
                    onClick={() => setPendingDelete(ide)}
                  >
                    <Trash className="ui-icon" size={12} color="currentColor" aria-hidden />
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
                    className="btn btn-sm btn-with-icon"
                    title={t('open.inFileManager')}
                    aria-label={t('open.inFileManager')}
                    onClick={() => void browseExe(ide.id, ide.executable)}
                  >
                    <FolderOpen className="ui-icon" size={14} color="currentColor" aria-hidden />
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
    </>
  )

  /** Add + Scan buttons used in both inline toolbar and modal actions */
  const addScanButtons = (
    <>
      <button
        type="button"
        className="btn btn-sm btn-with-icon"
        disabled={scanning}
        onClick={() => {
          setPickerQuery('')
          setPickerOpen(true)
        }}
      >
        <Add className="ui-icon" size={14} color="currentColor" aria-hidden />
        {t('ide.add')}
      </button>
      <button
        type="button"
        className="btn btn-sm btn-with-icon"
        disabled={scanning}
        onClick={() => void scanAndAddInstalled()}
      >
        {scanning ? (
          <Loader
            className="ui-icon is-spinning"
            size={14}
            color="currentColor"
            aria-hidden
          />
        ) : (
          <Refresh
            className="ui-icon"
            size={14}
            color="currentColor"
            aria-hidden
          />
        )}
        {scanning ? t('ide.scanning') : t('ide.redetect')}
      </button>
    </>
  )

  const modalActions = (
    <div className="modal-actions">
      {addScanButtons}
      <button type="button" className="btn" onClick={close} disabled={scanning}>
        {t('ide.cancel')}
      </button>
      <button
        type="button"
        className="btn primary btn-with-icon"
        disabled={scanning}
        onClick={() => void save()}
      >
        <Document className="ui-icon" size={14} color="currentColor" aria-hidden />
        {t('ide.save')}
      </button>
    </div>
  )

  if (inline) {
    return (
      <>
        <div className="settings-inline-panel">
          {content}
          <div className="ide-inline-toolbar">
            {addScanButtons}
            <button
              type="button"
              className="btn btn-sm primary btn-with-icon"
              style={{ marginLeft: 'auto' }}
              disabled={scanning || !draft}
              onClick={() => void save()}
            >
              <Document className="ui-icon" size={14} color="currentColor" aria-hidden />
              {t('ide.save')}
            </button>
          </div>
        </div>
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
            onSavePath={addFromTypedPath}
            onClose={() => setPickerOpen(false)}
          />
        )}
        {pendingDelete && (
          <ModalShell
            title={t('ide.delTitle')}
            onClose={() => setPendingDelete(null)}
            closeOnEsc={false}
            footer={
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
            }
          >
            <p className="muted">
              {t('ide.delConfirm', {
                name: pendingDelete.name || pendingDelete.id,
              })}
            </p>
          </ModalShell>
        )}
      </>
    )
  }

  return (
    <>
      <ModalShell title={t('ide.title')} onClose={close} wide footer={modalActions}>
        {content}
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
          onSavePath={addFromTypedPath}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {pendingDelete && (
        <ModalShell
          title={t('ide.delTitle')}
          onClose={() => setPendingDelete(null)}
          closeOnEsc={false}
          footer={
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
          }
        >
          <p className="muted">
            {t('ide.delConfirm', {
              name: pendingDelete.name || pendingDelete.id,
            })}
          </p>
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
  onSavePath,
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
  onSavePath: (path: string) => Promise<void> | void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [resolving, setResolving] = useState(false)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return editors
    return editors.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.executable.toLowerCase().includes(q),
    )
  }, [editors, query])

  // Heuristic: the query looks like a local executable path. The backend does
  // the real existence / extension validation when the user clicks Save.
  const pathCandidate = query.trim()
  const looksLikePath =
    pathCandidate.length > 0 &&
    (/[\\/]/.test(pathCandidate) || /^%[^%]+%/.test(pathCandidate))
  const canSavePath =
    looksLikePath && !resolving && !alreadyAdded(pathCandidate)

  const handleSavePath = () => {
    if (!canSavePath) return
    setResolving(true)
    Promise.resolve(onSavePath(pathCandidate)).finally(() =>
      setResolving(false),
    )
  }

  return (
    <ModalShell
      title={t('ide.pickTitle')}
      onClose={onClose}
      className="ide-picker-modal"
      footer={
        <div className="modal-actions ide-picker-actions">
          <button type="button" className="btn btn-with-icon" onClick={onManual}>
            <FolderOpen className="ui-icon" size={14} color="currentColor" aria-hidden />
            {t('ide.pickManual')}
          </button>
          <button type="button" className="btn btn-with-icon" onClick={onBlank}>
            <Add className="ui-icon" size={14} color="currentColor" aria-hidden />
            {t('ide.pickBlank')}
          </button>
          <div className="ide-picker-actions-spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={resolving}>
            {t('ide.cancel')}
          </button>
          <button
            type="button"
            className="btn primary btn-with-icon"
            disabled={!canSavePath}
            onClick={handleSavePath}
            title={t('ide.pickPathHint')}
          >
            <Document className="ui-icon" size={14} color="currentColor" aria-hidden />
            {resolving ? t('ide.scanning') : t('ide.pickSave')}
          </button>
        </div>
      }
    >
      <p className="muted">{t('ide.pickHint')}</p>
      <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
        {t('ide.envHint')}
      </p>
      <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
        {t('ide.pickPathHint')}
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
    </ModalShell>
  )
}
