// ALT_PLAY grants (docs/effect-dsl.md §4 Meta, 1PIC08):
// "PASSIVE: You may treat any INCIDENT's play operation as 'Play: …'".
//
// A static PASSIVE whose effect is an ALT_PLAY node offers its `operation` as
// an extra PLAY option for every card of the listed suits in the owner's hand,
// while the granting card's table operations are available (in play, not in
// Staging, not beamed — rules/03 §3.5.5; exhausted still counts, rules/12
// §12.25). The printed PLAY operations stay available too ("you may treat").
//
// A grant is addressed by the granting PASSIVE operation (`AltPlayRef`), not
// by an index into the played card's operations — so the OPERATION frame keeps
// resolving the same text even if the granting card leaves play mid-effect.

import type { CardInstanceId } from './ids'
import type { GameState } from './state'
import { inPlayCards, zoneProps } from './state'
import { cardDef } from './cards'
import type { Operation } from './resolver/nodes'
import type { Seat } from './resolver/queries'

/** The PASSIVE operation (card + index) that grants an alternate PLAY. */
export interface AltPlayRef {
	source: CardInstanceId
	opIndex: number
}

/** The granted operation behind `ref` (the ALT_PLAY node's `operation`), or
 *  null when `ref` does not name an ALT_PLAY declaration. Reads the static
 *  def only — the grant's current availability is `altPlayGrants`' job. */
export function altPlayOperation(
	state: GameState,
	ref: AltPlayRef,
): Operation | null {
	const card = state.cards[ref.source]
	if (card === undefined) return null
	const op = cardDef(card.def).operations[ref.opIndex]
	if (op === undefined || op.type !== 'PASSIVE' || op.trigger !== undefined)
		return null
	return op.effect.k === 'ALT_PLAY' ? op.effect.operation : null
}

/** Every ALT_PLAY grant `seat` may currently use to play hand card `iid`, in
 *  a stable order (in-play card id, then operation index). Only cards with at
 *  least one printed PLAY operation qualify — there must be a play operation
 *  to "treat as" something else (a "cannot be played" card stays unplayable). */
export function altPlayGrants(
	state: GameState,
	seat: Seat,
	iid: CardInstanceId,
): AltPlayRef[] {
	const card = state.cards[iid]
	if (card === undefined) return []
	const def = cardDef(card.def)
	if (!def.operations.some((op) => op.type === 'PLAY')) return []
	const out: AltPlayRef[] = []
	for (const source of [...inPlayCards(state, seat)].sort()) {
		const granter = state.cards[source]!
		if (!zoneProps(granter.zone).tableOps) continue
		cardDef(granter.def).operations.forEach((op, opIndex) => {
			if (op.type !== 'PASSIVE' || op.trigger !== undefined) return
			if (op.effect.k !== 'ALT_PLAY') return
			if (!op.effect.suits.includes(def.suit)) return
			out.push({ source, opIndex })
		})
	}
	return out
}
