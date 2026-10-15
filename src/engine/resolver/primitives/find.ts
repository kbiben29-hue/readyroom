import type { Effect } from '../nodes'
import type { Primitive } from './index'
import type { GameState, EffectCtx } from '../../state'
import type { ZoneSpec } from '../queries'
import { resolveQuery } from '../../queries/resolveQuery'
import { otherSeat } from '../../state'
import { shuffle } from '../../rng'
import { pickSingle, moveCard } from '../runtime'

/** The facedown decks (Draw / Reserve) a FIND searches, as zone keys.
 *  ZoneSpec seats are SELF-relative (0 = the actor). */
function searchedDecks(zones: readonly ZoneSpec[], ctx: EffectCtx): string[] {
	const out: string[] = []
	for (const z of zones) {
		if (typeof z !== 'object' || (z.k !== 'DRAW' && z.k !== 'RESERVE')) continue
		const seat = z.seat === 0 ? ctx.actor : otherSeat(ctx.actor)
		const key = `${z.k}:${seat}`
		if (!out.includes(key)) out.push(key)
	}
	return out
}

/** rules/08 find: "Afterwards, shuffle any facedown deck you looked through
 *  (Draw deck, Reserve deck)." Runs after the found card has left the deck;
 *  consumes state.rng (never in probe mode — the probe state is discarded). */
function shuffleSearched(
	state: GameState,
	zones: readonly ZoneSpec[],
	ctx: EffectCtx,
): GameState {
	if (state.probe === true) return state
	let next = state
	for (const key of searchedDecks(zones, ctx)) {
		const deck = next.zones[key] ?? []
		if (deck.length < 2) continue
		const [order, rng] = shuffle(deck, next.rng)
		next = { ...next, rng, zones: { ...next.zones, [key]: order } }
	}
	return next
}

export const find: Primitive<Extract<Effect, { k: 'FIND' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return (
			resolveQuery(state, { zones: node.zones, filter: node.filter }, ctx)
				.length > 0
		)
	},
	execute(state, node, ctx, _frame) {
		const candidates = resolveQuery(
			state,
			{ zones: node.zones, filter: node.filter },
			ctx,
		)
		const r = pickSingle(state, node, ctx, 'find', {
			prompt: 'Find a card',
			candidates,
			from: 'SEARCH',
		})
		if (r.kind === 'suspended') return r.state
		// Nothing matched: the decks were still looked through.
		if (r.kind === 'none') return shuffleSearched(state, node.zones, ctx)
		// Bind the found card so a later step can use it ("free play the found
		// card" — 1PIC07). ctx.bindings is shared forward.
		if (node.bind !== undefined) ctx.bindings[node.bind] = r.iids[0]!
		const moved = moveCard(state, r.iids[0]!, {
			k: 'HAND',
			seat: ctx.actor,
		})
		return shuffleSearched(moved, node.zones, ctx)
	},
}
