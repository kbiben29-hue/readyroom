import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { moveCard } from '../runtime'

export const enlistReserve: Primitive<
	Extract<Effect, { k: 'ENLIST_RESERVE' }>
> = {
	isCost: false,
	canResolve(state, _node, ctx) {
		return (state.zones[`RESERVE:${ctx.actor}`]?.length ?? 0) > 0
	},
	execute(state, _node, ctx, _frame) {
		const top = state.zones[`RESERVE:${ctx.actor}`]?.[0]
		if (top === undefined) return state // no-op if Reserve empty
		return moveCard(state, top, { k: 'DRAW', seat: ctx.actor }, { toTop: true })
	},
}
