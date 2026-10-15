// Canonical Market & Neutral Zone board operations (todo/08). "The Market" in
// card text ALWAYS means the four faceup offer cards, never the decks (rules/08
// → market) — every market code path (gain, scan, junk, wipe, Glory placement)
// funnels through `marketOffers`/`resolveMarketQuery` so that invariant is
// expressed once. `refillMarket` / `refillNeutralZone` were factored out of
// phases.ts (todo/06) so the phase machine and the acquisition primitives share
// exactly one implementation.

import {
	moveCard,
	zonesOf,
	zoneKey,
	type GameState,
	type EffectCtx,
} from './state'
import { resolveQuery } from './queries/resolveQuery'
import type { CardInstanceId } from './ids'
import type { MarketSuit } from '../data/ids'
import type { Seat, Query } from './resolver/queries'
import { addLog } from './resolver/runtime'

/** The four Market suits, in the printed card order. */
export const MARKET_SUITS_FOUR = ['PERSON', 'CARGO', 'SHIP', 'ALLY'] as const

/** The four faceup Market-offer cards — "the Market" (rules/08 → market). */
export function marketOffers(state: GameState): CardInstanceId[] {
	const out: CardInstanceId[] = []
	for (const suit of MARKET_SUITS_FOUR)
		out.push(...zonesOf(state, { k: 'MARKET_OFFER', suit }))
	return out
}

/** The suit of a faceup offer card, or undefined. */
export function suitOfOffer(
	state: GameState,
	iid: CardInstanceId,
): MarketSuit | undefined {
	const card = state.cards[iid]
	return card !== undefined && card.zone.k === 'MARKET_OFFER'
		? card.zone.suit
		: undefined
}

/** Offer-only view of a MarketQuery. Card text says "the Market" → the four
 *  faceup cards only; a card JSON that mistakenly lists a deck/other zone is
 *  dropped, so the alias's intent can't be violated by data. */
export function resolveMarketQuery(
	state: GameState,
	query: Query,
	ctx: EffectCtx,
): CardInstanceId[] {
	const offers = new Set(marketOffers(state))
	return resolveQuery(state, query, ctx).filter((iid) => offers.has(iid))
}

/** Reveal the next card of `suit`'s deck into its offer slot. If the deck is
 *  empty the slot stays empty — a legal, permanent state every Market code
 *  path must tolerate (rules/05 §5.4.4, rules/08 → gain). */
export function refillMarket(state: GameState, suit: MarketSuit): GameState {
	const top = state.zones[zoneKey({ k: 'MARKET_DECK', suit })]?.[0]
	if (top === undefined) return state
	return moveCard(state, top, { k: 'MARKET_OFFER', suit })
}

/** Reveal a Location into every empty Neutral Zone slot from the Location deck
 *  (rules/03 §3.4.2 #4, rules/06 §6.1.1). A Location leaving the Zone is
 *  always refilled immediately. */
export function refillNeutralZone(state: GameState): GameState {
	let s = state
	for (const slot of [0, 1, 2] as const) {
		if ((s.zones[zoneKey({ k: 'NEUTRAL_ZONE', slot })] ?? []).length > 0)
			continue
		const top = s.zones[zoneKey({ k: 'LOCATION_DECK' })]?.[0]
		if (top === undefined) continue
		s = moveCard(s, top, { k: 'NEUTRAL_ZONE', slot })
	}
	return s
}

/** Does a query name a card no box prints (rules/12 §12.30)? The card data
 *  writes that as an empty `ids` list — such a reference is unsatisfiable. */
export function referencesUnprinted(query: Query | undefined): boolean {
	const ids = query?.filter?.ids
	return ids !== undefined && ids.length === 0
}

/** Log a one-time warning that a query referenced an unprinted card
 *  (rules/12 §12.30); the query itself resolves empty (no such card exists),
 *  so this never throws. WARN-ish log uses kind INFO (no WARN kind exists). */
export function warnUnprinted(
	state: GameState,
	queries: readonly (Query | undefined)[],
	ctx: EffectCtx,
): GameState {
	if (!queries.some(referencesUnprinted)) return state
	if (state.log.some((e) => e.message.startsWith(UNPRINTED_MESSAGE)))
		return state
	return addLog(state, {
		kind: 'INFO',
		seat: ctx.actor,
		message: UNPRINTED_MESSAGE,
	})
}

const UNPRINTED_MESSAGE =
	'Unprinted card referenced — not in this box, no candidates (rules/12 §12.30)'

export type { Seat }
