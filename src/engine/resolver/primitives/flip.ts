import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { resolveQuery } from '../../queries/resolveQuery'
import type { GameState, EffectCtx } from '../../state'
import type { CardInstanceId } from '../../ids'

/** FLIP: turn a double-sided card over (2KHA01, 2KHA02): the instance keeps
 *  its zone, tokens and exhaustion and now shows the `to` side's def. */
export const flip: Primitive<Extract<Effect, { k: 'FLIP' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return targets(state, node, ctx).some((iid) => state.cards[iid]!.def !== node.to)
	},
	execute(state, node, ctx, _frame) {
		let next: GameState = state
		for (const iid of targets(state, node, ctx)) {
			const card = next.cards[iid]!
			if (card.def === node.to) continue
			next = { ...next, cards: { ...next.cards, [iid]: { ...card, def: node.to } } }
		}
		return next
	},
}

function targets(
	state: GameState,
	node: Extract<Effect, { k: 'FLIP' }>,
	ctx: EffectCtx,
): CardInstanceId[] {
	const iids = node.target === 'THIS' ? [ctx.source] : resolveQuery(state, node.target, ctx)
	return iids.filter((iid) => state.cards[iid] !== undefined)
}
