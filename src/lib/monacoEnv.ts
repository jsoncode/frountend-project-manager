import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

type MonacoEnv = {
  getWorker: (workerId: string, label: string) => Worker
}

let ready = false

/** Configure Monaco web workers for Vite (call once before creating an editor). */
export function setupMonacoEnvironment() {
  if (ready) return
  ready = true
  const env: MonacoEnv = {
    getWorker(_workerId: string, label: string) {
      if (label === 'json') return new jsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new cssWorker()
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker()
      }
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker()
      }
      return new editorWorker()
    },
  }
  ;(globalThis as typeof globalThis & { MonacoEnvironment: MonacoEnv }).MonacoEnvironment =
    env
}
