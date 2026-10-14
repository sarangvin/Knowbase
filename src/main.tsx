import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyTextSize, readTextSize } from './features/settings/textSize'
import { installApiGate } from './apiGate'

// Before anything can call the API — see apiGate.ts.
installApiGate()

// Before the first render, so a reader who chose a larger size never sees
// the app paint at the default and then jump.
applyTextSize(readTextSize())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
