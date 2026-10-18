import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { DesktopRoot } from './desktop/DesktopRoot'
import { isDesktop } from './desktop/bridge'
import App from './ui/App'
import { RecoverableErrorBoundary } from './ui/errorScreen'
import './ui/ui.css'

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
