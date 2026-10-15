import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { resolveQuery } from '../../queries/resolveQuery'
import { addLog } from '../runtime'
import { cardToken } from '../../../data/cardNames'

/** ASSIMILATE (1SHI02 "If your captain is BORG, assimilate it
 *  instead"): the Borg assimilate keyword is reserved — the rulebook gives
 *  it no meaning yet (rules/08 → assimilate,
 *  rules/12 §12.30). Recognised but inert, like DRONE: it logs a warning
 *  naming the card and never moves it or crashes. Because the card text says
 *  "instead", the replaced step (e.g. the LOG) still does not happen — the
 *  card simply stays where it is. */
export const assimilate: Primitive<Extract<Effect, { k: 'ASSIMILATE' }>> = {
	isCost: false,
	canResolve: () => true,
	execute(state, node, ctx, _frame) {
		const iids =
			node.target === 'THIS'
				? [ctx.duplicating ?? ctx.source]
				: resolveQuery(state, node.target, ctx)
		const names = iids
			.map((iid) => state.cards[iid])
			.filter((c) => c !== undefined)
			.map((c) => cardToken(c.def))
		const what = names.length > 0 ? names.join(', ') : 'nothing'
		return addLog(state, {
			kind: 'INFO',
			seat: ctx.actor,
			message: `ASSIMILATE ${what}: assimilate has no meaning in this box (rules/12 §12.30) — no effect`,
		})
	},
}
