import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { player } from '../../state'
import { spendAction } from '../runtime'

export const costAction: Primitive<Extract<Effect, { k: 'COST_ACTION' }>> = {
	isCost: true,
	canResolve: (s, _n, ctx) => player(s, ctx.actor).actions.available > 0,
	execute(state, _node, ctx, _frame) {
		return spendAction(state, ctx.actor)
	},
}
