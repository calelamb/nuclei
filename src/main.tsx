import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import './styles/tokens.css'
import './components/qec/workbench/qecWorkbench.css'
import './components/qec/workbench/qecWorkbenchResponsive.css'
import './index.css'
import './components/ui/ui.css'
import App from './App.tsx'
import { installFileDropGuard } from './platform/fileDropGuard'
import { installMonacoCancellationGuard } from './components/editor/monacoCancellation'
import { applyLearnQueryParam } from './stores/learnGateStore'

// Configure Monaco web workers for Vite — without this, Monaco's default
// worker creation fails silently in Tauri's WKWebView.
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  },
}

loader.config({ monaco })

// A shared `?learn` link switches the hidden Learn workspace on (persisted).
applyLearnQueryParam(window.location.search)

installFileDropGuard()
installMonacoCancellationGuard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
