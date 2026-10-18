import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { DesktopRoot } from './desktop/DesktopRoot'
import { isDesktop } from './desktop/bridge'
import App from './ui/App'
import { createWorkerRunner } from './ui/botRunner'
import { RecoverableErrorBoundary } from './ui/errorScreen'
import { setBotRunner } from './ui/store'
import './ui/ui.css'

// The house AI thinks in a Web Worker (src/ui/botWorker.ts) so a long search
// never freezes the board; it falls back to the main thread where workers are
// unavailable. Tests keep the store's in-thread default.
setBotRunner(createWorkerRunner())

// Outer safety net (todo/17 §5): an engine throw anywhere in the render tree
// shows the recoverable error screen with a copyable session, never a white
// page. The GameFlow board also has its own boundary, so a board crash keeps
// the top bar / undo usable.
createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<RecoverableErrorBoundary>
			{isDesktop() ? (
				<DesktopRoot>
					<App />
				</DesktopRoot>
			) : (
				<App />
			)}
		</RecoverableErrorBoundary>
	</StrictMode>,
)
