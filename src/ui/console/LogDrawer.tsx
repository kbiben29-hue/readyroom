// The game log as a drawer on the right edge of the board. It opens only when
// asked — L, or the Log button in the head bar — never by itself, and L, Esc or
// the button close it. It sits under the modals, so clicking a log row opens
// the card detail on top of it.

import { useCallback } from 'react'
import { LogPanel } from '../log'
import { useProjected } from '../store'
import { useConsoleUi } from './consoleUi'
import { useEscape } from './useShortcut'

export function LogDrawer() {
	const projected = useProjected()
	const open = useConsoleUi((s) => s.logOpen)
	const setLogOpen = useConsoleUi((s) => s.setLogOpen)
	const entries = projected?.log.length ?? 0
	const close = useCallback(
		() => setLogOpen(false, entries),
		[setLogOpen, entries],
	)
	useEscape(open, close)
	if (!open) return null
	return (
		<aside className="log-drawer" aria-label="Log drawer">
			<button
				type="button"
				className="btn micro log-drawer-close"
				onClick={close}
				title="Close the log (L)"
			>
				Close <kbd>L</kbd>
			</button>
			<LogPanel />
		</aside>
	)
}
