// The enlist placement, shared by ENLIST_DEVELOPMENT and the 'enlist.place'
// script. Kept free of the primitive registry so script.ts can import it
// without an import cycle.

import { moveCard } from '../runtime'
import { cardDef } from '../../cards'
import type { GameState } from '../../state'
import type { CardInstanceId } from '../../ids'

/** Enlist = the Development goes on top of the Draw deck; a card's `onEnlist`
 *  ("When enlisting this card, …" — 2ARC06/07) then resolves for its owner. */
export function placeEnlisted(
	state: GameState,
	iid: CardInstanceId,
	seat: 0 | 1,
): GameState {
	// a STATUS Development goes into play when enlisted (3RIK09: "When this
	// card is enlisted, put it into play immediately")
	const status = cardDef(state.cards[iid]!.def).suit === 'STATUS'
	const next = moveCard(
		state,
		iid,
		status ? { k: 'STATUS', seat } : { k: 'DRAW', seat },
		status ? undefined : { toTop: true },
	)
	const onEnlist = cardDef(next.cards[iid]!.def).onEnlist
	if (onEnlist !== undefined)
		next.stack.push({
			k: 'EFFECT',
			node: onEnlist,
			ctx: { actor: seat, source: iid, bindings: {} },
			ip: 0,
		})
	return next
}
