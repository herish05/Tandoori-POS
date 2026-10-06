import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/App'
import { installGlobalErrorHandlers } from '@/lib/logger'
import './index.css'

installGlobalErrorHandlers()

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
