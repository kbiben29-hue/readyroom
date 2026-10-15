import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { addLog, handoffStardate } from '../runtime'

/** REMOVE_STARDATE_GLORY: "Remove N {GLO} from the Stardate card" (1BUR12
 *  1BUR12). The tokens go back to the supply. Emptying the current card runs
 *  the §3.6.4 handoff exactly like a Glory gain or the Clean-up placement
 *  (rules/03 §3.6.3–§3.6.4). Nothing happens once a Resolution was
 *  triggered or no Stardate card holds Glory. */
export const removeStardateGlory: Primitive<
	Extract<Effect, { k: 'REMOVE_STARDATE_GLORY' }>
> = {
	isCost: false,
	canResolve: () => true,
	execute(state, node, ctx) {
		let next = state
		let removed = 0
		for (let i = 0; i < node.amount; i++) {
			if (next.resolutionTriggered) break
			if (next.stardates.pile.length === 0) break
			if (next.stardates.gloryOnTop <= 0) break
			const gloryOnTop = next.stardates.gloryOnTop - 1
			next = { ...next, stardates: { ...next.stardates, gloryOnTop } }
			removed++
			if (gloryOnTop <= 0) next = handoffStardate(next, ctx.actor)
		}
		if (removed === 0) return state
		return addLog(next, {
			kind: 'BENEFIT',
			seat: ctx.actor,
			message: `removes ${removed} {GLO} from the Stardate card`,
		})
	},
}
