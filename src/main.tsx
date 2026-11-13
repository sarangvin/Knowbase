import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyTextSize, readTextSize } from './features/settings/textSize'
import { installApiGate } from './apiGate'
import { installUpdateCheck } from './appVersion'
import { rememberRef } from './vault/remoteSource'
import { captureDeepLink } from './deepLink'

// Before anything can call the API — see apiGate.ts.
installApiGate()

// A phone keeps the app open for days; see appVersion.ts.
installUpdateCheck()

// Credit a later sign-up to the reel link that brought them (?ref=yt|ig).
rememberRef()

// An email's "Start reading" / "Continue learning" link names a note.
captureDeepLink()

// Before the first render, so a reader who chose a larger size never sees
// the app paint at the default and then jump.
applyTextSize(readTextSize())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
