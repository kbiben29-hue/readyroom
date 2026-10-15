import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { ignoreAttack as mark } from '../replacement'

/** IGNORE_ATTACK (docs/effect-dsl.md §6 "would" windows): "… to ignore the
 *  negative effect". Only meaningful in an operation triggered by
 *  WOULD_BE_ATTACKED (schema-enforced): it marks that pending attack — scope
 *  ATTACK skips every remaining negative effect of the attack (1SIS06, 1SIS10,
 *  1PER19), EFFECT only the one that opened the window (1BUR15, 1CAR11). */
export const ignoreAttack: Primitive<Extract<Effect, { k: 'IGNORE_ATTACK' }>> =
	{
		isCost: false,
		canResolve: () => true,
		execute: (state, node, ctx) => mark(state, ctx, node.scope ?? 'ATTACK'),
	}
