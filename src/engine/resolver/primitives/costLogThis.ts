import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { costCanResolve, moveCard, emit } from '../runtime'

export const costLogThis: Primitive<Extract<Effect, { k: 'COST_LOG_THIS' }>> = {
	isCost: true,
	canResolve: (s, _n, ctx) =>
		costCanResolve(s, { k: 'COST_LOG_THIS' } as Effect, ctx),
	execute(state, _node, ctx, _frame) {
		const iid = ctx.duplicating ?? ctx.source
		// CARD_LOGGED like LOG / COST_LOG ("When you log this card (via any
		// effect)" — 1SHR06 SPECIAL)
		return emit(moveCard(state, iid, { k: 'LOG', seat: ctx.actor }), {
			k: 'CARD_LOGGED',
			iid,
			seat: ctx.actor,
		})
	},
}
