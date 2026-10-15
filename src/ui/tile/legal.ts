// The one legality input the tiles and the phone shells read: the viewer's
// legal intents right now. Locally that is the store's `legal` (legalIntents
// on the real state, for the active seat); an online source will hand the
// seat view's own list to the same place. Nothing on the phone re-derives
// legality from engine queries — a line is lit iff its intent is listed here.

import type { Intent } from '../../engine/intents'
import { useGameStore } from '../store'

const NONE: readonly Intent[] = []

/** The legal moves when they are the viewer's to make: the store lists the
 *  active seat's, and in hot-seat the device may still show the other
 *  captain until it is passed. Reads only the projected view. */
export function useViewerLegal(): readonly Intent[] {
	return useGameStore((s) =>
		// online, the seat view's list is already this seat's (it includes
		// decisions owed on the opponent's turn)
		s.online !== null
			? s.legal
			: s.projected !== null && s.projected.activeSeat === s.viewerSeat
				? s.legal
				: NONE,
	)
}
