import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { costCanResolve, markOperationPaid, payResource } from '../runtime'
import { evalAmount } from '../../queries/resolveQuery'

export const costResource: Primitive<Extract<Effect, { k: 'COST_RESOURCE' }>> =
	{
		isCost: true,
		canResolve: (s, n, ctx) => costCanResolve(s, n, ctx),
		execute(state, node, ctx, _frame) {
			const amount = evalAmount(state, node.amount, ctx)
			if (amount <= 0) return state
			return markOperationPaid(
				payResource(state, ctx.actor, node.res, amount),
				node.res,
			)
		},
	}
