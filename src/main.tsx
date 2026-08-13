import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

/**
 * Main FPM window entry — never mounts AiApp.
 *
 * No <StrictMode>: its dev-only double-mount races the imperative pty
 * lifecycle (XtermSession mounts → pty_spawn, unmounts → pty_kill), killing
 * every terminal shell in `tauri dev`.
 */
const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Missing #root')
}

createRoot(rootEl).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)
