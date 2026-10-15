import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { canPayResource, markOperationPaid, payResource } from '../runtime'
import { evalAmount } from '../../queries/resolveQuery'

/** SPEND_RESOURCE: a benefit-phrased spend (prefer COST_RESOURCE for costs). */
export const spendResource: Primitive<
	Extract<Effect, { k: 'SPEND_RESOURCE' }>
> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return canPayResource(
			state,
			ctx.actor,
			node.res,
			evalAmount(state, node.amount, ctx),
		)
	},
	execute(state, node, ctx, _frame) {
		const amount = evalAmount(state, node.amount, ctx)
		if (amount <= 0) return state
		return markOperationPaid(
			payResource(state, ctx.actor, node.res, amount),
			node.res,
		)
	},
}
