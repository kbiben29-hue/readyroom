import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { costCanResolve } from '../runtime'

/** A pure condition gate inside a cost: payable iff `cond` holds, pays nothing
 *  (development cost "{DIL} x6, and have 10+ {GLO}" — 1KOL05). */
export const costRequire: Primitive<Extract<Effect, { k: 'COST_REQUIRE' }>> = {
	isCost: true,
	canResolve: (s, n, ctx) => costCanResolve(s, n, ctx),
	execute(state, _node, _ctx, _frame) {
		return state
	},
}
