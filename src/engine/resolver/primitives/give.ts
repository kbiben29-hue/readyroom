import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { pickSingle, setOwner } from '../runtime'
import { moveCard } from '../../state'
import { resolveQuery } from '../../queries/resolveQuery'
import type { GameState, EffectCtx } from '../../state'
import type { CardInstanceId } from '../../ids'

type Node = Extract<Effect, { k: 'GIVE' }>

function candidates(state: GameState, node: Node, ctx: EffectCtx): CardInstanceId[] {
	if (node.target === 'THIS')
		return state.cards[ctx.source] !== undefined ? [ctx.source] : []
	return resolveQuery(state, node.target, ctx)
}

/** GIVE: hand one of your cards to your opponent — it becomes theirs, in their
 *  Discard pile or hand ("give your opponent an INCIDENT", "put this card in
 *  your opponent's Discard pile" — 2KHA05, 2KHA19–21). For an INCIDENT this is
 *  not a take: no INCIDENT_TAKEN event. */
export const give: Primitive<Node> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return candidates(state, node, ctx).length > 0
	},
	execute(state, node, ctx, _frame) {
		const r = pickSingle(state, node, ctx, 'give', {
			prompt: 'Give which card?',
			candidates: candidates(state, node, ctx),
			from: 'GIVE',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		const iid = r.iids[0]!
		const other = (1 - ctx.actor) as 0 | 1
		const next = setOwner(state, iid, other)
		return moveCard(next, iid, { k: node.to, seat: other })
	},
}
