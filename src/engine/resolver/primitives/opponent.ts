import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { otherSeat } from '../../state'

export const opponent: Primitive<Extract<Effect, { k: 'OPPONENT' }>> = {
	isCost: false,
	canResolve: () => true,
	execute(state, node, ctx, _frame) {
		state.stack.push({
			k: 'EFFECT',
			node: node.body,
			ctx: { ...ctx, actor: otherSeat(ctx.actor) },
			ip: 0,
		})
		return state
	},
}
