import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { player, type GameState } from '../../state'

/** MODIFIER_DETACH: remove a named rule-modifier layer (typically when its
 *  source card leaves play / is logged). */
export const modifierDetach: Primitive<
	Extract<Effect, { k: 'MODIFIER_DETACH' }>
> = {
	isCost: false,
	canResolve: () => true,
	execute(state, node, ctx, _frame) {
		const p = player(state, ctx.actor)
		if (!p.modifiers.some((m) => m.id === node.id)) return state
		const modifiers = p.modifiers.filter((m) => m.id !== node.id)
		const players = state.players.map((pl) =>
			pl.seat === ctx.actor ? { ...pl, modifiers } : pl,
		) as [GameState['players'][0], GameState['players'][1]]
		return { ...state, players }
	},
}
