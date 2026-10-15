import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { gainAction as gainActions } from '../runtime'
import { evalAmount } from '../../queries/resolveQuery'

/** GAIN_ACTION: always resolvable. */
export const gainAction: Primitive<Extract<Effect, { k: 'GAIN_ACTION' }>> = {
	isCost: false,
	canResolve: () => true,
	execute(state, node, ctx, _frame) {
		const amount = evalAmount(state, node.amount, ctx)
		if (amount <= 0) return state
		return gainActions(state, ctx.actor, amount)
	},
}
