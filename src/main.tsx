import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import AiApp from './ai/AiApp'
import { ErrorBoundary } from './components/ErrorBoundary'

const isAi = window.location.hash.startsWith('#/ai')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>{isAi ? <AiApp /> : <App />}</ErrorBoundary>
  </StrictMode>,
)
