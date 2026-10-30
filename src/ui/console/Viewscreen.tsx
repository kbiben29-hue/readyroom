// "On screen": the opponent's whole board at your card size (V, or a click on
// the opponent band), framed like the main viewscreen and dropped over the
// shared row. Their in-play zones and full crew console — the band shows the
// same cards small; this is for reading them. V, Esc or a click outside the
// frame puts it away.

import { useCallback } from 'react'
import type { Seat } from '../../engine/resolver/queries'
import { CrewBoard, PlayerArea } from '../board'
import { seatLabel } from '../format'
import { useConsoleUi } from './consoleUi'
import { useEscape } from './useShortcut'

export function Viewscreen({ seat }: { seat: Seat }) {
	const open = useConsoleUi((s) => s.viewscreen)
	const setViewscreen = useConsoleUi((s) => s.setViewscreen)
	const close = useCallback(() => setViewscreen(false), [setViewscreen])
	useEscape(open, close)
	if (!open) return null
	return (
		<div className="viewscreen-backdrop" onClick={close}>
			<section
				className="viewscreen"
				role="dialog"
				aria-label={`${seatLabel(seat)} on screen`}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="viewscreen-head">
					<span className="viewscreen-cap" aria-hidden="true" />
					<strong>{seatLabel(seat)} · on screen</strong>
					<button type="button" className="btn micro" onClick={close}>
						Close <kbd>V</kbd>
					</button>
				</div>
				<div className="viewscreen-body">
					<PlayerArea seat={seat} head={false} />
					<CrewBoard seat={seat} />
				</div>
			</section>
		</div>
	)
}
