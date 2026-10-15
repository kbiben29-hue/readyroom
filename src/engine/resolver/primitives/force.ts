import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { otherSeat } from '../../state'

/** FORCE is sugar for OPPONENT (docs/effect-dsl.md §4): the actor flips, so
 *  every PendingChoice inside carries the opponent's seat (rules/12 §12.14). */
export const force: Primitive<Extract<Effect, { k: 'FORCE' }>> = {
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
