import type * as monaco from 'monaco-editor'
import type { EditorThemeId } from './types'

/**
 * Custom Monaco editor themes for the application.
 * Built-in themes: 'vs-dark', 'vs', 'hc-black'
 * Custom themes: 'fpm-dark', 'fpm-midnight', 'fpm-dracula'
 */

export type EditorThemeOption = {
  id: EditorThemeId
  label: string
  /** Whether this is a dark theme (for UI hints) */
  dark: boolean
}

/** All available editor themes (was misspelled `EDITOR_THEMS`, audit QO-6). */
export const EDITOR_THEMES: EditorThemeOption[] = [
  { id: 'vs-dark', label: 'Dark (Default)', dark: true },
  { id: 'fpm-dark', label: 'FPM Dark', dark: true },
  { id: 'fpm-midnight', label: 'Midnight', dark: true },
  { id: 'fpm-dracula', label: 'Dracula', dark: true },
  { id: 'vs', label: 'Light', dark: false },
  { id: 'hc-black', label: 'High Contrast', dark: true },
]

/** Themes only need defining once — every later call is a no-op (audit QO-4). */
let themesRegistered = false

/**
 * Register all custom themes with Monaco.
 * Call once after setupMonacoEnvironment(). Idempotent.
 */
export function registerEditorThemes(monacoInstance: typeof monaco) {
  if (themesRegistered) return
  themesRegistered = true
  // FPM Dark — warm dark with teal accents
  monacoInstance.editor.defineTheme('fpm-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'C586C0' },
      { token: 'string', foreground: 'CE9178' },
      { token: 'number', foreground: 'B5CEA8' },
      { token: 'type', foreground: '4EC9B0' },
      { token: 'function', foreground: 'DCDCAA' },
      { token: 'variable', foreground: '9CDCFE' },
      { token: 'constant', foreground: '4FC1FF' },
      { token: 'regexp', foreground: 'D16969' },
      { token: 'tag', foreground: '569CD6' },
      { token: 'attribute.name', foreground: '9CDCFE' },
      { token: 'attribute.value', foreground: 'CE9178' },
    ],
    colors: {
      'editor.background': '#1E1E2E',
      'editor.foreground': '#CDD6F4',
      'editor.lineHighlightBackground': '#2A2A3E',
      'editor.selectionBackground': '#45475A',
      'editor.inactiveSelectionBackground': '#3A3A50',
      'editorCursor.foreground': '#89B4FA',
      'editorLineNumber.foreground': '#585880',
      'editorLineNumber.activeForeground': '#89B4FA',
      'editor.selectionHighlightBackground': '#3A3A5080',
      'editor.wordHighlightBackground': '#45475A80',
      'editor.findMatchBackground': '#F9E2AF44',
      'editor.findMatchHighlightBackground': '#F9E2AF22',
      'editorIndentGuide.background': '#3A3A5060',
      'editorIndentGuide.activeBackground': '#585880',
      'editorBracketMatch.background': '#45475A60',
      'editorBracketMatch.border': '#89B4FA40',
      'editorGutter.background': '#1E1E2E',
      'minimap.background': '#1E1E2E',
    },
  })

  // Midnight — deep blue-black
  monacoInstance.editor.defineTheme('fpm-midnight', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '5C6370', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'C678DD' },
      { token: 'string', foreground: '98C379' },
      { token: 'number', foreground: 'D19A66' },
      { token: 'type', foreground: 'E5C07B' },
      { token: 'function', foreground: '61AFEF' },
      { token: 'variable', foreground: 'E06C75' },
      { token: 'constant', foreground: '56B6C2' },
      { token: 'regexp', foreground: '98C379' },
      { token: 'tag', foreground: 'E06C75' },
    ],
    colors: {
      'editor.background': '#0D1117',
      'editor.foreground': '#C9D1D9',
      'editor.lineHighlightBackground': '#161B22',
      'editor.selectionBackground': '#264F78',
      'editor.inactiveSelectionBackground': '#1C2936',
      'editorCursor.foreground': '#58A6FF',
      'editorLineNumber.foreground': '#484F58',
      'editorLineNumber.activeForeground': '#58A6FF',
      'editor.selectionHighlightBackground': '#17202A80',
      'editor.wordHighlightBackground': '#17202A60',
      'editor.findMatchBackground': '#F0883E44',
      'editor.findMatchHighlightBackground': '#F0883E22',
      'editorIndentGuide.background': '#21262D60',
      'editorIndentGuide.activeBackground': '#484F58',
      'editorBracketMatch.background': '#17202A60',
      'editorBracketMatch.border': '#58A6FF40',
      'editorGutter.background': '#0D1117',
      'minimap.background': '#0D1117',
    },
  })

  // Dracula — inspired by the popular Dracula theme
  monacoInstance.editor.defineTheme('fpm-dracula', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6272A4', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'FF79C6' },
      { token: 'string', foreground: 'F1FA8C' },
      { token: 'number', foreground: 'BD93F9' },
      { token: 'type', foreground: '8BE9FD' },
      { token: 'function', foreground: '50FA7B' },
      { token: 'variable', foreground: 'F8F8F2' },
      { token: 'constant', foreground: 'BD93F9' },
      { token: 'regexp', foreground: 'FFB86C' },
      { token: 'tag', foreground: 'FF79C6' },
      { token: 'attribute.name', foreground: '50FA7B' },
      { token: 'attribute.value', foreground: 'F1FA8C' },
    ],
    colors: {
      'editor.background': '#282A36',
      'editor.foreground': '#F8F8F2',
      'editor.lineHighlightBackground': '#44475A',
      'editor.selectionBackground': '#44475A',
      'editor.inactiveSelectionBackground': '#3A3D4D',
      'editorCursor.foreground': '#F8F8F2',
      'editorLineNumber.foreground': '#6272A4',
      'editorLineNumber.activeForeground': '#F8F8F2',
      'editor.selectionHighlightBackground': '#44475A80',
      'editor.wordHighlightBackground': '#44475A60',
      'editor.findMatchBackground': '#FFB86C44',
      'editor.findMatchHighlightBackground': '#FFB86C22',
      'editorIndentGuide.background': '#44475A60',
      'editorIndentGuide.activeBackground': '#6272A4',
      'editorBracketMatch.background': '#44475A60',
      'editorBracketMatch.border': '#F8F8F240',
      'editorGutter.background': '#282A36',
      'minimap.background': '#282A36',
    },
  })
}

/**
 * Apply the given theme to all Monaco editor instances.
 * Falls back to 'vs-dark' if the theme id is unknown.
 */
export function applyEditorTheme(
  monacoInstance: typeof monaco,
  themeId: EditorThemeId | undefined,
) {
  const id = themeId ?? 'vs-dark'
  monacoInstance.editor.setTheme(id)
}
