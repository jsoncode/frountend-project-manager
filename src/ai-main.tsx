import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import AiApp from './ai/AiApp'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AntdProvider } from './theme/AntdProvider'

/**
 * Dedicated AI window entry — always mounts AiApp.
 * Do not share main.tsx shell detection (hash / query / label races).
 */
const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Missing #root')
}

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <AntdProvider>
        <AiApp />
      </AntdProvider>
    </ErrorBoundary>
  </StrictMode>,
)
