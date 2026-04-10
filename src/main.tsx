import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import './index.css'
import App from './App.tsx'

// Pin Monaco to a known-stable version. The @monaco-editor/loader default is
// 0.55.1 which throws "Illegal value for lineNumber" on init in some browsers.
// 0.52.2 is the last confirmed stable release compatible with
// @monaco-editor/react 4.7.x. Must be configured BEFORE any Editor mounts.
loader.config({
  paths: {
    vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs',
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
