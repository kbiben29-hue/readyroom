import type { Effect } from '../nodes'
import type { Primitive } from './index'

/** Resolve steps in order, one primitive per executeOne (instruction-pointer SEQ). */
export const seq: Primitive<Extract<Effect, { k: 'SEQ' }>> = {
	isCost: false,
	canResolve: () => true,
	execute(state, node, ctx, frame) {
		if (frame.ip >= node.steps.length) return state
		state.stack.push({ k: 'EFFECT', node: frame.node, ctx, ip: frame.ip + 1 })
		state.stack.push({ k: 'EFFECT', node: node.steps[frame.ip]!, ctx, ip: 0 })
		return state
	},
}
