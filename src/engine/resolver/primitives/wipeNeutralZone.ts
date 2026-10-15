import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { zonesOf, moveCard, type GameState } from '../../state'
import { refillNeutralZone } from '../../market'
import type { CardInstanceId } from '../../ids'

/** WIPE_NEUTRAL_ZONE (rules/03 §3.6.2, rules/12 §12.20): junk only neutral
 *  LOCATIONS bearing NO tokens (no away teams, no ship tokens, no resource
 *  tokens — either player's), then refill the Zone. Token-bearing Locations
 *  are spared. */
export const wipeNeutralZone: Primitive<
	Extract<Effect, { k: 'WIPE_NEUTRAL_ZONE' }>
> = {
	isCost: false,
	canResolve(state, _node, _ctx) {
		return neutrals(state).some((iid) => bare(state, iid))
	},
	execute(state, _node, _ctx, _frame) {
		let next = state
		for (const iid of neutrals(next)) {
			if (!bare(next, iid)) continue
			next = moveCard(next, iid, { k: 'JUNK' })
		}
		return refillNeutralZone(next)
	},
}

function neutrals(state: GameState): CardInstanceId[] {
	const out: CardInstanceId[] = []
	for (const slot of [0, 1, 2] as const)
		out.push(...zonesOf(state, { k: 'NEUTRAL_ZONE', slot }))
	return out
}

function bare(state: GameState, iid: CardInstanceId): boolean {
	const at = state.awayTeamsAt[iid]
	if (at !== undefined && (at[0] ?? 0) + (at[1] ?? 0) > 0) return false
	for (const card of Object.values(state.cards)) {
		if (card.shipTokenAt === iid) return false
	}
	const tokens = state.cards[iid]!.resourceTokens
	return Object.values(tokens).every((v) => v === undefined || v === 0)
}
