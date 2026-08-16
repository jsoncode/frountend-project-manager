import { createRoot } from 'react-dom/client'
import AiApp from './ai/AiApp'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AntdProvider } from './theme/AntdProvider'

/**
 * Dedicated AI window entry — always mounts AiApp.
 * Do not share main.tsx shell detection (hash / query / label races).
 *
 * No <StrictMode>: its dev-only double-mount runs startAiListeners() twice
 * concurrently, racing the shared `unlisten*` module slots and double-appending
 * streamed text (audit M20 — aligned with main.tsx).
 */
const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Missing #root')
}

createRoot(rootEl).render(
  <ErrorBoundary>
    <AntdProvider>
      <AiApp />
    </AntdProvider>
  </ErrorBoundary>,
)
