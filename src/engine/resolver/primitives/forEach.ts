import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { resolveQuery } from '../../queries/resolveQuery'

export const forEach: Primitive<Extract<Effect, { k: 'FOR_EACH' }>> = {
	isCost: false,
	canResolve: () => true,
	execute(state, node, ctx, _frame) {
		const matches = resolveQuery(state, node.over, ctx)
		for (let i = matches.length - 1; i >= 0; i--) {
			const bindings = { ...ctx.bindings, [node.bind]: matches[i]! }
			state.stack.push({
				k: 'EFFECT',
				node: node.body,
				ctx: { ...ctx, bindings },
				ip: 0,
			})
		}
		return state
	},
}
