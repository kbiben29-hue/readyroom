import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { evalPredicate } from '../../queries/resolveQuery'

export const ifNode: Primitive<Extract<Effect, { k: 'IF' }>> = {
	isCost: false,
	canResolve: () => true,
	execute(state, node, ctx, _frame) {
		const branch = evalPredicate(state, node.cond, ctx) ? node.then : node.else
		if (branch !== undefined)
			state.stack.push({ k: 'EFFECT', node: branch, ctx, ip: 0 })
		return state
	},
}
