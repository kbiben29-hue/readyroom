import type { Effect } from '../nodes'
import type { Primitive } from './index'

export const noop: Primitive<Extract<Effect, { k: 'NOOP' }>> = {
	isCost: false,
	canResolve: () => true,
	execute: (state) => state,
}
