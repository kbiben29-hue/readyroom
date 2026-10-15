import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { player, type GameState } from '../../state'
import type { CardInstanceId } from '../../ids'
import type { Seat } from '../queries'
import { resolveQuery } from '../../queries/resolveQuery'

/** MODIFIER_ATTACH (docs/data-model.md §7): attach a named rule-modifier
 *  layered on the acting player, sourced from the current card. The hooks
 *  themselves live in a registry keyed by `id` (todo/05+); the state only
 *  stores `{ id, source }` — plain JSON.
 *
 *  With `target`, the layer is sourced from each matched card instead (the
 *  deployed SHIP counting as CLOAK until the turn ends — TEMP_CLOAK on
 *  `$event.card`, 1KOL03/1CAR03): trait grants apply to the source card, and
 *  the layer drops with it when it leaves play. */
export const modifierAttach: Primitive<
	Extract<Effect, { k: 'MODIFIER_ATTACH' }>
> = {
	isCost: false,
	// a target that matches nothing (the card already left play) attaches
	// nothing — never blocks the rest of the operation.
	canResolve: () => true,
	execute(state, node, ctx, _frame) {
		const sources: CardInstanceId[] =
			node.target === undefined
				? [ctx.source]
				: resolveQuery(state, node.target, ctx)
		let next = state
		for (const source of sources) next = attach(next, node, ctx.actor, source)
		return next
	},
}

function attach(
	state: GameState,
	node: Extract<Effect, { k: 'MODIFIER_ATTACH' }>,
	seat: Seat,
	source: CardInstanceId,
): GameState {
	const p = player(state, seat)
	// idempotent unless stacking; a targeted layer is per card
	if (
		node.stack !== true &&
		p.modifiers.some(
			(m) =>
				m.id === node.id && (node.target === undefined || m.source === source),
		)
	)
		return state
	const players = state.players.map((pl) =>
		pl.seat === seat
			? { ...pl, modifiers: [...pl.modifiers, { id: node.id, source }] }
			: pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return { ...state, players }
}
