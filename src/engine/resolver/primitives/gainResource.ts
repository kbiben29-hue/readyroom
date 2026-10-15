import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { gainResource as gainRes, resolveAmount } from '../runtime'

/** GAIN_RESOURCE: always resolvable; gaining a resource never fails. Amounts
 *  route through `resolveAmount` so an UP_TO gain auto-resolves to `max`
 *  (gaining for yourself is a pure benefit: todo/04 §10 / todo/07 §2). */
export const gainResource: Primitive<Extract<Effect, { k: 'GAIN_RESOURCE' }>> =
	{
		isCost: false,
		canResolve: () => true,
		execute(state, node, ctx, _frame) {
			const r = resolveAmount(state, node, ctx, 'gainRes.amount', {
				prompt: 'Gain how many?',
				amount: node.amount,
				pure: true,
			})
			if (r.kind === 'suspended') return r.state
			if (r.amount <= 0) return state
			return gainRes(state, ctx.actor, node.res, r.amount, {
				fromSupply: node.fromSupply,
			})
		},
	}
