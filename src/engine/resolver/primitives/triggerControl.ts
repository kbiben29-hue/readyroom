import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { suspend, answered, answer, addLog } from '../runtime'
import { pushOperation } from '../stack'
import { resolveQuery } from '../../queries/resolveQuery'
import { cardDef } from '../../cards'
import type { GameState } from '../../state'
import type { CardInstanceId } from '../../ids'

/** TRIGGER_CONTROL (rules/08 → trigger): resolve ONLY the CONTROL operation of
 *  a controlled Location. Does NOT emit LOCATION_CONTROLLED or PUT_INTO_PLAY,
 *  does NOT move tokens or beamed cards, and does NOT cost an action unless
 *  the operation itself says so (the OPERATION frame applies op.costsAction).
 *  It is not "taking control" for REACTION purposes (rules/08 → trigger). */
export const triggerControl: Primitive<
	Extract<Effect, { k: 'TRIGGER_CONTROL' }>
> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return candidates(state, node, ctx).length > 0
	},
	execute(state, node, ctx, _frame) {
		const key = 'triggerControl.loc'
		if (answered(ctx, key)) {
			return trigger(state, ctx, answer<CardInstanceId>(ctx, key))
		}
		const cands = candidates(state, node, ctx)
		if (cands.length === 0) return state
		if (cands.length === 1) return trigger(state, ctx, cands[0]!)
		return suspend(state, node, ctx, key, {
			k: 'CHOOSE_LOCATION',
			prompt: 'Trigger which Location?',
			candidates: cands,
		})
	},
}

/** Only controlled Locations carry a CONTROL operation to trigger. */
function candidates(
	state: GameState,
	node: Effect & { k: 'TRIGGER_CONTROL' },
	ctx: Parameters<Primitive<Effect>['execute']>[2],
): CardInstanceId[] {
	return resolveQuery(state, node.target, ctx).filter((iid) => {
		const card = state.cards[iid]!
		return (
			card.zone.k === 'LOCATION_AREA' &&
			cardDef(card.def).operations.some((o) => o.type === 'CONTROL')
		)
	})
}

function trigger(
	state: GameState,
	ctx: Parameters<Primitive<Effect>['execute']>[2],
	loc: CardInstanceId,
): GameState {
	const ops = cardDef(state.cards[loc]!.def).operations
	const ctrlIndex = ops.findIndex((o) => o.type === 'CONTROL')
	if (ctrlIndex < 0) return state
	let next = pushOperation(state, loc, ctrlIndex, {
		actor: ctx.actor,
		source: loc,
		bindings: {},
	})
	next = addLog(next, {
		kind: 'EVENT',
		seat: ctx.actor,
		message: `triggers ${loc}'s CONTROL`,
	})
	return next
}
