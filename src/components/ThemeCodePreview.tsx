import { Segmented } from 'antd'
import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { setupMonacoEnvironment } from '../lib/monacoEnv'
import { applyEditorTheme, registerEditorThemes } from '../lib/monacoThemes'
import { useI18n } from '../i18n/useI18n'
import { useSettingsStore } from '../stores/settingsStore'

const EDITOR_FONT = "Consolas, 'Courier New', ui-monospace, monospace"

type Lang = 'javascript' | 'typescript' | 'json'

// Sample code strings are built with array join to avoid backtick-in-backtick
// escaping issues that confuse some parsers (e.g. Vite's oxc).
const SAMPLE_CODE: Record<Lang, string> = {
  javascript: [
    '// JavaScript example',
    "import { useState } from 'react'",
    '',
    "const API_BASE = 'https://api.example.com'",
    '',
    'async function fetchUser(id) {',
    "  const res = await fetch(API_BASE + '/users/' + id)",
    "  if (!res.ok) throw new Error('Not found')",
    '  return res.json()',
    '}',
    '',
    'export function useUser(userId) {',
    '  const [user, setUser] = useState(null)',
    '  useEffect(() => {',
    '    fetchUser(userId).then(setUser)',
    '  }, [userId])',
    '  return user',
    '}',
  ].join('\n'),
  typescript: [
    '// TypeScript example',
    'interface User {',
    '  id: number',
    '  name: string',
    '  roles: Role[]',
    '}',
    '',
    "type Role = 'admin' | 'editor' | 'viewer'",
    '',
    'export class UserService<T extends User> {',
    '  constructor(private items: T[] = []) {}',
    '',
    '  add(item: T): void {',
    '    this.items.push(item)',
    '  }',
    '',
    '  findByRole(role: Role): T[] {',
    '    return this.items.filter((u) => u.roles.includes(role))',
    '  }',
    '}',
  ].join('\n'),
  json: [
    '{',
    '  "name": "frontend-project-manager",',
    '  "version": "1.0.0",',
    '  "scripts": {',
    '    "dev": "vite",',
    '    "build": "tsc && vite build"',
    '  },',
    '  "dependencies": {',
    '    "react": "^18.2.0",',
    '    "monaco-editor": "^0.45.0"',
    '  },',
    '  "devDependencies": {',
    '    "typescript": "^5.3.0",',
    '    "vite": "^5.0.0"',
    '  }',
    '}',
  ].join('\n'),
}

const TAB_LABELS: Record<Lang, string> = {
  javascript: 'JS',
  typescript: 'TS',
  json: 'JSON',
}

/**
 * Read-only Monaco editor that previews the currently selected theme
 * with sample code in JavaScript, TypeScript, and JSON.
 */
export function ThemeCodePreview() {
  const editorTheme = useSettingsStore((s) => s.config?.editorTheme ?? 'vs-dark')
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [activeLang, setActiveLang] = useState<Lang>('javascript')

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    setupMonacoEnvironment()
    registerEditorThemes(monaco)

    const editor = monaco.editor.create(el, {
      value: SAMPLE_CODE[activeLang],
      language: activeLang,
      theme: editorTheme,
      readOnly: true,
      automaticLayout: true,
      fontFamily: EDITOR_FONT,
      fontSize: 12.5,
      lineHeight: 18,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      wordWrap: 'on',
      lineNumbers: 'on',
      folding: false,
      scrollbar: {
        vertical: 'hidden',
        horizontal: 'hidden',
        verticalScrollbarSize: 0,
        horizontalScrollbarSize: 0,
      },
      padding: { top: 6, bottom: 6 },
      tabSize: 2,
    })
    editorRef.current = editor

    return () => {
      editor.dispose()
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    monaco.editor.setModelLanguage(model, activeLang)
    if (model.getValue() !== SAMPLE_CODE[activeLang]) {
      model.setValue(SAMPLE_CODE[activeLang])
    }
  }, [activeLang])

  useEffect(() => {
    applyEditorTheme(monaco, editorTheme)
  }, [editorTheme])

  return (
    <div className="theme-code-preview">
      <div className="theme-code-preview-tabs">
        <Segmented
          size="small"
          value={activeLang}
          onChange={(v) => setActiveLang(v as Lang)}
          options={(Object.keys(SAMPLE_CODE) as Lang[]).map((lang) => ({
            label: TAB_LABELS[lang],
            value: lang,
          }))}
        />
        <span className="theme-code-preview-label muted">
          {t('settings.themePreviewLabel')}
        </span>
      </div>
      <div className="theme-code-preview-editor" ref={containerRef} />
    </div>
  )
}
