import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { addLog } from '../runtime'

/** DRONE (1CAR02 "regenerate 1 drone" / "send a drone to any LOCATION"): the
 *  Borg drone keyword is reserved — the rulebook gives it no meaning
 *  yet (rules/08 → drone, rules/12 §12.30). Recognised but
 *  inert: it resolves to a no-op that logs a warning, never crashes. */
export const drone: Primitive<Extract<Effect, { k: 'DRONE' }>> = {
	isCost: false,
	canResolve: () => true,
	execute(state, node, ctx, _frame) {
		return addLog(state, {
			kind: 'INFO',
			seat: ctx.actor,
			message: `DRONE ${node.verb}: drone has no meaning in this box (rules/12 §12.30) — no effect`,
		})
	},
}
