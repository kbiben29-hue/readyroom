import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { suspend, answered, answer, addLog } from '../runtime'
import { moveCard, zonesOf, type GameState, type EffectCtx } from '../../state'
import type { CardInstanceId } from '../../ids'
import type { ZoneRef } from '../queries'

type Node = Extract<Effect, { k: 'ARRANGE_DECK' }>
type Deck = Node['decks'][number]

const REF: Record<Deck, ZoneRef> = {
	LOCATION: { k: 'LOCATION_DECK' },
	ENCOUNTER: { k: 'ENCOUNTER_DECK' },
}

/** ARRANGE_DECK: peek at the top N cards of the LOCATION deck and re-stack
 *  them on top and/or bottom in any order (1SIS21); with a choice of
 *  LOCATION or ENCOUNTER (1CAR16) the player first picks the
 *  deck (CHOOSE_OPTION, only decks that hold a card). Then the acting player
 *  picks which looked-at cards go to the bottom (CHOOSE_CARDS 0..N) and orders
 *  each group (ORDER_CARDS, first = uppermost; skipped for a single card).
 *  Nothing moves until every answer is in, so a resume re-reads the same top
 *  cards. */
export const arrangeDeck: Primitive<Node> = {
	isCost: false,
	canResolve: (state, node) =>
		node.decks.some((d) => zonesOf(state, REF[d]).length > 0),
	execute(state, node, ctx) {
		const decks = node.decks.filter((d) => zonesOf(state, REF[d]).length > 0)
		if (decks.length === 0) return state
		let deck: Deck
		if (decks.length === 1) deck = decks[0]!
		else if (!answered(ctx, 'arrange.deck')) {
			return suspend(state, node, ctx, 'arrange.deck', {
				k: 'CHOOSE_OPTION',
				prompt: `Look at the top ${node.n} of which deck?`,
				options: decks.map((d) => ({
					key: d,
					label: `the top ${node.n} ${d}`,
					enabled: true,
					reason: undefined,
				})),
			})
		} else deck = answer<{ key: Deck }>(ctx, 'arrange.deck').key
		const looked = zonesOf(state, REF[deck]).slice(0, node.n)
		if (!answered(ctx, 'arrange.bottom')) {
			return suspend(state, node, ctx, 'arrange.bottom', {
				k: 'CHOOSE_CARDS',
				prompt: `Which of the top ${looked.length} ${deck} go to the bottom of the deck? (the rest stay on top)`,
				candidates: [...looked],
				min: 0,
				max: looked.length,
				from: deck,
				optional: true,
			})
		}
		const bottom = answer<CardInstanceId[]>(ctx, 'arrange.bottom')
		const top = looked.filter((iid) => !bottom.includes(iid))
		const topOrder = orderOf(ctx, 'arrange.topOrder', top)
		if (topOrder === null)
			return askOrder(state, node, ctx, 'arrange.topOrder', top, 'top')
		const bottomOrder = orderOf(ctx, 'arrange.bottomOrder', bottom)
		if (bottomOrder === null)
			return askOrder(state, node, ctx, 'arrange.bottomOrder', bottom, 'bottom')
		return place(state, ctx, REF[deck], topOrder, bottomOrder)
	},
}

/** The answered order of `cards`, the cards themselves when there is nothing
 *  to order, or null while the ORDER_CARDS is still to be asked. */
function orderOf(
	ctx: EffectCtx,
	key: string,
	cards: CardInstanceId[],
): CardInstanceId[] | null {
	if (cards.length <= 1) return cards
	return answered(ctx, key) ? answer<CardInstanceId[]>(ctx, key) : null
}

function askOrder(
	state: GameState,
	node: Node,
	ctx: EffectCtx,
	key: string,
	cards: CardInstanceId[],
	where: 'top' | 'bottom',
): GameState {
	return suspend(state, node, ctx, key, {
		k: 'ORDER_CARDS',
		prompt:
			where === 'top'
				? 'Order the cards on top of the deck (first = the top card)'
				: 'Order the cards at the bottom of the deck (first = the uppermost of them)',
		cards: [...cards],
	})
}

function place(
	state: GameState,
	ctx: EffectCtx,
	deck: ZoneRef,
	topOrder: CardInstanceId[],
	bottomOrder: CardInstanceId[],
): GameState {
	let next = state
	// the top group: insert from the last up, so the first ends on top
	for (let i = topOrder.length - 1; i >= 0; i--)
		next = moveCard(next, topOrder[i]!, deck, { toTop: true })
	// the bottom group: append in order, so the first is the uppermost of them
	for (const iid of bottomOrder) next = moveCard(next, iid, deck)
	return addLog(next, {
		kind: 'BENEFIT',
		seat: ctx.actor,
		message: `rearranges the top of the ${deck.k === 'LOCATION_DECK' ? 'Location' : 'Encounter'} deck (${topOrder.length} on top, ${bottomOrder.length} to the bottom)`,
	})
}
