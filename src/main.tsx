import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { DesktopRoot } from './desktop/DesktopRoot'
import { isDesktop } from './desktop/bridge'
import * as nativeBridge from './desktop/bridge'
import App from './ui/App'
import * as browserBridge from './desktop/browserBridge'
import { prepareOfflineApp } from './offline'
import { createWorkerRunner } from './ui/botRunner'
import { RecoverableErrorBoundary } from './ui/errorScreen'
import { setBotRunner } from './ui/store'
import { installButtonClicks } from './ui/gameSounds'
import { installSoundUnlock } from './ui/sound'
import './ui/ui.css'

// The house AI thinks in a Web Worker (src/ui/botWorker.ts) so a long search
// never freezes the board; it falls back to the main thread where workers are
// unavailable. Tests keep the store's in-thread default.
setBotRunner(createWorkerRunner())

// sound effects (src/ui/sound.ts): unlock audio on the first gesture, and a
// soft key-tap for button presses
installSoundUnlock()
installButtonClicks()

// Outer safety net (todo/17 §5): an engine throw anywhere in the render tree
// shows the recoverable error screen with a copyable session, never a white
// page. The GameFlow board also has its own boundary, so a board crash keeps
// the top bar / undo usable.
function renderApp() {
	createRoot(document.getElementById('root')!).render(
		<StrictMode>
			<RecoverableErrorBoundary>
				{isDesktop() || import.meta.env.MODE === 'pages' ? (
					<DesktopRoot bridge={isDesktop() ? nativeBridge : browserBridge}>
						<App />
					</DesktopRoot>
				) : (
					<App />
				)}
			</RecoverableErrorBoundary>
		</StrictMode>,
	)
}

if (import.meta.env.MODE === 'pages') {
	void prepareOfflineApp()
		.then(renderApp)
		.catch((error) => {
			const root = document.getElementById('root')!
			root.textContent =
				'Offline setup could not finish. Connect to the internet and reload. ' +
				String(error)
			const retry = document.createElement('button')
			retry.textContent = 'Retry'
			retry.onclick = () => location.reload()
			root.appendChild(retry)
		})
} else renderApp()
