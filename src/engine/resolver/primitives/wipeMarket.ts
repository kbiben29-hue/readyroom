import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { zonesOf, type GameState } from '../../state'
import { moveCard } from '../runtime'
import { refillMarket, MARKET_SUITS_FOUR } from '../../market'
import type { CardInstanceId } from '../../ids'

/** WIPE_MARKET (rules/03 §3.6.2, rules/12 §12.19): return every resource token
 *  on all four offer cards to the supply, junk all four, then refill each
 *  offered suit. Wipe IGNORES the token restriction JUNK enforces
 *  (rules/12 §12.19), so it junks token-bearing offers too. Refilling each
 *  suit is todo/08-owned (rules/03 §3.6.2). */
export const wipeMarket: Primitive<Extract<Effect, { k: 'WIPE_MARKET' }>> = {
	isCost: false,
	canResolve(state, _node, _ctx) {
		return offers(state).length > 0
	},
	execute(state, _node, _ctx, _frame) {
		let next = state
		for (const suit of MARKET_SUITS_FOUR) {
			for (const iid of zonesOf(next, { k: 'MARKET_OFFER', suit })) {
				const card = next.cards[iid]!
				// tokens return to the supply (they just vanish — not gained)
				next = {
					...next,
					cards: { ...next.cards, [iid]: { ...card, resourceTokens: {} } },
				}
				next = moveCard(next, iid, { k: 'JUNK' })
			}
			next = refillMarket(next, suit)
		}
		return next
	},
}

function offers(state: GameState): CardInstanceId[] {
	const out: CardInstanceId[] = []
	for (const suit of MARKET_SUITS_FOUR)
		out.push(...zonesOf(state, { k: 'MARKET_OFFER', suit }))
	return out
}
