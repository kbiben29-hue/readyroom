import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { evalAmount } from '../../queries/resolveQuery'
import type { GameState } from '../../state'

/** SCORE_VP (docs/effect-dsl.md §7): ENDGAME/SPECIAL-only; add the evaluated
 *  amount to the acting player's running VP total. Scoring is provisional —
 *  the data model parks it on `GameState.scoreVp` (todo/10 finalises the
 *  scoring pass). */
export const scoreVp: Primitive<Extract<Effect, { k: 'SCORE_VP' }>> = {
	isCost: false,
	canResolve: () => true,
	execute(state, node, ctx, _frame) {
		const amount = evalAmount(state, node.amount, ctx)
		if (amount === 0) return state
		const scoreVp: GameState['scoreVp'] = {
			...state.scoreVp,
			[ctx.actor]: (state.scoreVp[ctx.actor] ?? 0) + amount,
		}
		return { ...state, scoreVp }
	},
}
