import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { pickCards, suspend, answered, answer, skipBenefit } from '../runtime'
import { evalAmount } from '../../queries/resolveQuery'
import { zonesOf, moveCard } from '../../state'
import { cardDef } from '../../cards'
import { scanIncludesJunk } from '../../modifiers'
import type { CardInstanceId } from '../../ids'
import type { MarketSuit } from '../../../data/ids'
import type { GameState, EffectCtx } from '../../state'
import { finish as gainFinish } from './gainCard'

/** SCAN_N (rules/05 §5.4.2, rules/08 → scan): choose a suit (locked once
 *  chosen — the other suits' faceup cards become ineligible; rules/05 §5.4.2
 *  "choose one"), reveal `min(n, deck.length)` cards from that deck (face-up
 *  to the acting player only — informational, no state change), then gain ONE
 *  of { the revealed cards, the faceup offer, the Junk pile (includeJunk) },
 *  placing it via CHOOSE_DESTINATION. Any revealed-but-unpicked cards go to
 *  the BOTTOM of the deck in a player-chosen order (ORDER_CARDS, auto when ≤1
 *  remain). A faceup-offer gain transfers its Glory tokens and refills the
 *  slot (rules/05 §5.4.4). No cards anywhere of the chosen suit → no effect
 *  (SKIPPED). Emits CARD_GAINED, so REACTIONs on gaining fire from a scan too
 *  (rules/08 → scan). */
export const scanN: Primitive<Extract<Effect, { k: 'SCAN_N' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return node.suits.some(
			(suit) => candidates(state, suit, node, ctx).length > 0,
		)
	},
	execute(state, node, ctx, _frame) {
		const suitKey = 'scanN.suit'
		const pickKey = 'scanN.pick'
		const destKey = 'scanN.dest'
		const orderKey = 'scanN.order'

		// 5. ORDER_CARDS answered → place the rest at the bottom in that order.
		if (answered(ctx, orderKey)) {
			return placeAtBottom(state, answer<CardInstanceId[]>(ctx, orderKey))
		}
		// 4. destination answered → place the picked card, then order the rest.
		if (answered(ctx, destKey)) {
			return finishGain(
				state,
				node,
				ctx,
				answer<'DECK_TOP' | 'DISCARD'>(ctx, destKey),
			)
		}
		// 3. a card was picked → ask where it goes.
		if (answered(ctx, pickKey)) {
			const picked = pickedOf(state, node, ctx)
			return suspend(state, node, ctx, destKey, {
				k: 'CHOOSE_DESTINATION',
				prompt: 'Place the scanned card?',
				card: picked,
				options: ['DECK_TOP', 'DISCARD'],
			})
		}
		// 1. suit locked once chosen (no take-backs).
		const suits = [...new Set(node.suits)]
		if (suits.length > 1 && !answered(ctx, suitKey)) {
			const offered = suits.filter(
				(s) => candidates(state, s, node, ctx).length > 0,
			)
			return suspend(state, node, ctx, suitKey, {
				k: 'CHOOSE_SUIT',
				suits: offered,
				prompt: 'Scan which suit?',
			})
		}
		const suit = suits.length > 1 ? answer<MarketSuit>(ctx, suitKey) : suits[0]!
		const cands = candidates(state, suit, node, ctx)
		if (cands.length === 0) {
			return skipBenefit(state, node, ctx, `no ${suit} cards to scan`)
		}
		// 2. reveal up to n deck-top cards, then pick one to gain. Nothing has
		//    moved, so the revealed set is re-derivable on every resume.
		const r = pickCards(state, node, ctx, pickKey, {
			prompt: `Gain a ${suit} from the scan`,
			candidates: cands,
			min: 1,
			max: 1,
			from: `MARKET:${suit}`,
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		return suspend(state, node, ctx, destKey, {
			k: 'CHOOSE_DESTINATION',
			prompt: 'Place the scanned card?',
			card: r.iids[0]!,
			options: ['DECK_TOP', 'DISCARD'],
		})
	},
}

function nOf(
	state: GameState,
	node: Effect & { k: 'SCAN_N' },
	ctx: EffectCtx,
): number {
	return Math.max(0, Math.floor(evalAmount(state, node.n, ctx)))
}

/** Revealed deck cards = the top `min(n, deck.length)` of the suit's deck
 *  (informational — they stay put until the gained card is placed). */
function revealedOf(
	state: GameState,
	suit: MarketSuit,
	n: number,
): CardInstanceId[] {
	const deck = zonesOf(state, { k: 'MARKET_DECK', suit })
	return deck.slice(0, Math.min(n, deck.length))
}

/** Every legal SCAN_N candidate for `suit`: revealed deck cards + the faceup
 *  offer + (includeJunk) the matching Junk pile. Deduplicated. */
function candidates(
	state: GameState,
	suit: MarketSuit,
	node: Effect & { k: 'SCAN_N' },
	ctx: EffectCtx,
): CardInstanceId[] {
	const out: CardInstanceId[] = [
		...revealedOf(state, suit, nOf(state, node, ctx)),
		...zonesOf(state, { k: 'MARKET_OFFER', suit }),
	]
	if (node.includeJunk === true || scanIncludesJunk(state, ctx.actor)) {
		for (const iid of zonesOf(state, { k: 'JUNK' })) {
			if (cardDef(state.cards[iid]!.def).suit === suit) out.push(iid)
		}
	}
	const seen = new Set<CardInstanceId>()
	const unique: CardInstanceId[] = []
	for (const iid of out) {
		if (!seen.has(iid)) {
			seen.add(iid)
			unique.push(iid)
		}
	}
	return unique
}

/** The picked card, re-derived on resume the way gainCard does: nothing has
 *  moved until the destination is answered, so a single auto-selected
 *  candidate is still valid. */
function pickedOf(
	state: GameState,
	node: Effect & { k: 'SCAN_N' },
	ctx: EffectCtx,
): CardInstanceId {
	if (answered(ctx, 'scanN.pick')) {
		const sel = answer<CardInstanceId[]>(ctx, 'scanN.pick')
		if (sel.length !== 1) throw new Error(`SCAN_N: expected one picked card`)
		return sel[0]!
	}
	const suits = [...new Set(node.suits)]
	const suit =
		suits.length > 1 ? answer<MarketSuit>(ctx, 'scanN.suit') : suits[0]!
	const cands = candidates(state, suit, node, ctx)
	if (cands.length !== 1)
		throw new Error(
			`SCAN_N: cannot re-derive an auto-picked card (${cands.length} candidates)`,
		)
	return cands[0]!
}

/** Place the picked card (gainCard.finish handles tokens + refill for faceup
 *  offers), then send the remaining revealed deck cards to the BOTTOM via
 *  ORDER_CARDS (auto when ≤1 remains — nothing to order). */
function finishGain(
	state: GameState,
	node: Effect & { k: 'SCAN_N' },
	ctx: EffectCtx,
	dest: 'DECK_TOP' | 'DISCARD',
): GameState {
	const picked = pickedOf(state, node, ctx)
	const suits = [...new Set(node.suits)]
	const suit =
		suits.length > 1 ? answer<MarketSuit>(ctx, 'scanN.suit') : suits[0]!
	const revealed = revealedOf(state, suit, nOf(state, node, ctx))
	const rest = revealed.filter((iid) => iid !== picked)
	// Bind the gained card for a later "if the gained card is X" IF (todo/13).
	if (node.bind !== undefined) ctx.bindings[node.bind] = picked
	const next = gainFinish(state, ctx.actor, picked, dest)
	// `rest` are still on top of the deck; put them at the bottom in the
	// player's chosen order.
	if (rest.length <= 1) return placeAtBottom(next, rest)
	return suspend(
		next,
		node,
		ctx,
		'scanN.order',
		{
			k: 'ORDER_CARDS',
			prompt:
				'Put the unscanned cards at the bottom of the deck (top-to-bottom)?',
			cards: rest,
		},
		{ '$scanN.suit': suit },
	)
}

/** Put `ordered` at the bottom of their suit's deck in the given order: each
 *  card is appended in the chosen sequence so the final bottom order matches
 *  the list (rules/05 §5.4.2). */
function placeAtBottom(
	state: GameState,
	ordered: readonly CardInstanceId[],
): GameState {
	let next = state
	for (const iid of ordered) {
		const suit = cardDef(next.cards[iid]!.def).suit as MarketSuit
		next = moveCard(next, iid, { k: 'MARKET_DECK', suit })
	}
	return next
}
