import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { pickSingle } from '../runtime'
import { evalAmount, resolveQuery } from '../../queries/resolveQuery'

/** PLACE_TOKENS: put N resource tokens from the supply on a card ("place 1
 *  {DIL} on Earth" — 2ARC02, 2ARC19). Several matching cards → the player picks. */
export const placeTokens: Primitive<Extract<Effect, { k: 'PLACE_TOKENS' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return (
			evalAmount(state, node.amount, ctx) > 0 &&
			resolveQuery(state, node.target, ctx).length > 0
		)
	},
	execute(state, node, ctx, _frame) {
		const amount = evalAmount(state, node.amount, ctx)
		if (amount <= 0) return state
		const r = pickSingle(state, node, ctx, 'placeTokens', {
			prompt: 'Place the tokens on which card?',
			candidates: resolveQuery(state, node.target, ctx),
			from: 'TOKENS',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		const iid = r.iids[0]!
		const card = state.cards[iid]!
		const tokens = {
			...card.resourceTokens,
			[node.res]: (card.resourceTokens[node.res] ?? 0) + amount,
		}
		return {
			...state,
			cards: { ...state.cards, [iid]: { ...card, resourceTokens: tokens } },
		}
	},
}
