import type { Effect } from '../nodes'
import type { Primitive } from './index'
import {
	costCanResolve,
	failOperation,
	moveCard,
	zonesOf,
	emit,
	gainResource,
	setOwner,
} from '../runtime'
import { isCadetOpponent } from '../../../bot/cadet'
import { otherSeat } from '../../state'

export const costTakeIncident: Primitive<
	Extract<Effect, { k: 'COST_TAKE_INCIDENT' }>
> = {
	isCost: true,
	canResolve: (s, n, ctx) => costCanResolve(s, n, ctx),
	execute(state, node, ctx, _frame) {
		// rules/10 §10.2 #4 (cost variant): a forced incident-cost on the opponent
		// substitutes 1 Glory instead and never drains the Incident deck.
		if (isCadetOpponent(state.mode, ctx.actor)) {
			return gainResource(state, otherSeat(ctx.actor), 'GLO', node.count)
		}
		const deck = zonesOf(state, { k: 'INCIDENT_DECK' })
		if (deck.length < node.count)
			return failOperation(state, 'COST_TAKE_INCIDENT: not enough incidents')
		let next = state
		for (let i = 0; i < node.count; i++) {
			const top = next.zones['INCIDENT_DECK']?.[0]
			if (top === undefined) break
			// Taking puts the INCIDENT under the taker's ownership, exactly like
			// TAKE — without it the card sits owner-less in HAND, which the
			// projection hides from its holder and the Burn never counts.
			next = setOwner(next, top, ctx.actor)
			next = emit(moveCard(next, top, { k: 'HAND', seat: ctx.actor }), {
				k: 'CARD_DRAWN',
				iid: top,
				seat: ctx.actor,
			})
			// Taking an INCIDENT as a cost is still taking one (todo/09 §1).
			next = emit(next, { k: 'INCIDENT_TAKEN', iid: top, seat: ctx.actor })
		}
		return next
	},
}
