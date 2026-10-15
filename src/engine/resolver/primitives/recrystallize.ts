import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { evalAmount } from '../../queries/resolveQuery'
import { zonesOf, type GameState } from '../../state'
import { gainResource } from '../runtime'
import type { CardInstanceId } from '../../ids'

/** RECRYSTALLIZE (BUR only, docs/effect-dsl §4): "move Dilithium from her
 *  1BUR02 Status card into her personal pool" (rules/08 §recrystallize
 *  + rules/11 §11.6.1 #6). Moves `amount` DIL resource tokens (`'ALL'` = every
 *  parked one — 1BUR10) off her STATUS cards into the pool; no-op
 *  when none are parked. The move is not an operation gain, so the Inert
 *  Dilithium redirect (rule #3) never parks it straight back. */
export const recrystallize: Primitive<Extract<Effect, { k: 'RECRYSTALLIZE' }>> =
	{
		isCost: false,
		canResolve(state, _node, ctx) {
			return parkedDilithium(state, ctx.actor) > 0
		},
		execute(state, node, ctx, _frame) {
			const parked = parkedDilithium(state, ctx.actor)
			const want =
				node.amount === 'ALL'
					? parked
					: Math.max(0, evalAmount(state, node.amount, ctx))
			if (parked <= 0 || want <= 0) return state
			const take = Math.min(want, parked)
			let next = state
			let moved = 0
			for (const iid of statusCardsWithDilithium(state, ctx.actor)) {
				if (moved >= take) break
				const card = state.cards[iid]!
				const onCard = card.resourceTokens.DIL ?? 0
				const takeFrom = Math.min(take - moved, onCard)
				if (takeFrom <= 0) continue
				const tokens: GameState['cards'][string]['resourceTokens'] = {
					...card.resourceTokens,
					DIL: onCard - takeFrom,
				}
				next = {
					...next,
					cards: { ...next.cards, [iid]: { ...card, resourceTokens: tokens } },
				}
				moved += takeFrom
			}
			return gainResource(next, ctx.actor, 'DIL', moved, { via: 'OTHER' })
		},
	}

function statusCards(
	state: GameState,
	seat: GameState['players'][0]['seat'],
): CardInstanceId[] {
	return zonesOf(state, { k: 'STATUS', seat })
}

function statusCardsWithDilithium(
	state: GameState,
	seat: GameState['players'][0]['seat'],
): CardInstanceId[] {
	return statusCards(state, seat).filter(
		(iid) => (state.cards[iid]!.resourceTokens.DIL ?? 0) > 0,
	)
}

function parkedDilithium(
	state: GameState,
	seat: GameState['players'][0]['seat'],
): number {
	let total = 0
	for (const iid of statusCards(state, seat))
		total += state.cards[iid]!.resourceTokens.DIL ?? 0
	return total
}
