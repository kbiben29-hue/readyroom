import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { evalAmount, resolveQuery } from '../../queries/resolveQuery'
import type { Amount } from '../queries'

export const letNode: Primitive<Extract<Effect, { k: 'LET' }>> = {
	isCost: false,
	canResolve: () => true,
	execute(state, node, ctx, _frame) {
		const isQuery =
			typeof node.value === 'object' &&
			node.value !== null &&
			'zones' in node.value
		const value: number | string[] = isQuery
			? resolveQuery(
					state,
					node.value as Parameters<typeof resolveQuery>[1],
					ctx,
				)
			: evalAmount(state, node.value as Amount, ctx)
		const bindings = { ...ctx.bindings, [node.bind]: value }
		state.stack.push({
			k: 'EFFECT',
			node: node.body,
			ctx: { ...ctx, bindings },
			ip: 0,
		})
		return state
	},
}
