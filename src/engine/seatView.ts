// The wire view of a game for one seat (docs/ui-mobile.md §7 — the online
// server sends this, never the raw state). `project(state, seat)` already
// swaps hidden faces for HIDDEN_DEF; that is enough on a shared screen, but not
// over the wire, because instance ids are NOT opaque: setup mints them in
// catalog order before shuffling ("p1#0042" is always the same card of a given
// deck), so any id a client sees in a hidden zone names the card, and the
// order of `zones['DRAW:1']` would spell out the deck. The seat view therefore
//
//   - renames every card hidden from the seat to a positional alias
//     (`hidden:<zoneKey>:<index>`, e.g. `hidden:HAND:1:3`) in the board
//     structures — cards, zones, the pending choice, legal intents — and
//     re-sorts the `cards` map so its key order carries no mint order;
//   - replaces hidden ids in history structures (the engine log, the token
//     trail, resolved-op refs) with the opaque HIDDEN_IID, so an old log line
//     can never be matched to a deck position;
//   - drops the RNG (the seed would let a client replay every shuffle), the
//     effect stack and event queue (engine internals whose bindings can hold
//     hidden selections), and the other seat's pending choice (its candidate
//     list would reveal which hand positions qualify).
//
// Submissions come back through `unmaskValue`, which maps positional aliases
// to the real ids of the SAME state version (the server's optimistic version
// check guarantees the client masked against that state).
//
// Also here: the pure reveal detectors the server's undo floor uses —
// `rngDraws` (did the intent consume real randomness?) and `revealedCards`
// (did any face become visible to a seat?). Everything is pure and
// deterministic; no DOM, no clock.

import type { GameState } from './state'
import type { CardInstanceId } from './ids'
import type { Seat } from './resolver/queries'
import { zoneKey } from './state'
import { hiddenCards, project, type ProjectedState } from './projection'

/** Prefix of a positional alias for a hidden card (board structures). */
export const HIDDEN_ALIAS_PREFIX = 'hidden:'

/** Opaque stand-in for a hidden card in history structures (log, fx). */
export const HIDDEN_IID = 'hidden'

/** Every card instance id the engine mints matches this (setup's
 *  `<prefix>#<serial>`: `p0#0042`, `cm#0101`, `sd#0200`). Used to find ids
 *  inside serialised JSON, including ids embedded in log messages. */
export const IID_TOKEN = /[A-Za-z][A-Za-z0-9]*#\d+/g

/** The per-seat, per-state renaming table. */
export interface SeatMask {
	seat: Seat
	/** real id → positional alias, for every card hidden from `seat` */
	toAlias: ReadonlyMap<string, string>
	/** positional alias → real id */
	toReal: ReadonlyMap<string, string>
}

export function isHiddenAlias(id: string): boolean {
	return id.startsWith(HIDDEN_ALIAS_PREFIX)
}

/** Build the mask for `seat`: each hidden card is named by where it sits
 *  (zone key + index in that zone's array), which the seat can see anyway. */
export function seatMask(state: GameState, seat: Seat): SeatMask {
	const hidden = hiddenCards(state, seat)
	const toAlias = new Map<string, string>()
	const toReal = new Map<string, string>()
	let orphan = 0
	for (const iid of [...hidden].sort()) {
		const card = state.cards[iid]!
		const key = zoneKey(card.zone)
		const index = state.zones[key]?.indexOf(iid) ?? -1
		const alias =
			index >= 0
				? `${HIDDEN_ALIAS_PREFIX}${key}:${index}`
				: `${HIDDEN_ALIAS_PREFIX}${key}:?${orphan++}`
		toAlias.set(iid, alias)
		toReal.set(alias, iid)
	}
	return { seat, toAlias, toReal }
}

/** How hidden ids are renamed: `board` = positional alias (current-state
 *  references the seat can act on), `history` = the opaque HIDDEN_IID. */
export type MaskMode = 'board' | 'history'

/** Deep-copy a JSON value, renaming every hidden card id — as a whole string,
 *  as an object key, or embedded in text. */
export function maskValue<T>(value: T, mask: SeatMask, mode: MaskMode): T {
	if (value === undefined) return value
	const json = JSON.stringify(value)
	const out = json.replace(IID_TOKEN, (token) => {
		const alias = mask.toAlias.get(token)
		if (alias === undefined) return token
		return mode === 'board' ? alias : HIDDEN_IID
	})
	return JSON.parse(out) as T
}

/** Inverse of a `board` mask for client submissions: every string that is a
 *  known positional alias becomes the real id again. Unknown aliases are left
 *  alone (the engine's legality/validation gate then rejects them). */
export function unmaskValue<T>(value: T, mask: SeatMask): T {
	const walk = (v: unknown): unknown => {
		if (typeof v === 'string') return mask.toReal.get(v) ?? v
		if (Array.isArray(v)) return v.map(walk)
		if (v !== null && typeof v === 'object') {
			const out: Record<string, unknown> = {}
			for (const [k, inner] of Object.entries(v)) {
				out[mask.toReal.get(k) ?? k] = walk(inner)
			}
			return out
		}
		return v
	}
	return walk(value) as T
}

/** The state a seat receives over the wire (see the header). Pass the mask
 *  when the caller already built it for this state (to mask legal intents). */
export function seatView(
	state: GameState,
	seat: Seat,
	mask: SeatMask = seatMask(state, seat),
): ProjectedState {
	const projected = project(state, seat) as unknown as GameState
	const { log, fx, resolvedOps, cards, ...board } = projected
	const scrubbed: Omit<GameState, 'log' | 'fx' | 'resolvedOps' | 'cards'> = {
		...board,
		rng: { seed: 0, counter: 0 },
		stack: [],
		eventQueue: [],
		triggerGuard: { passives: [] },
		pendingChoice:
			board.pendingChoice !== null && board.pendingChoice.seat === seat
				? board.pendingChoice
				: null,
	}
	delete scrubbed.probe
	const maskedBoard = maskValue(scrubbed, mask, 'board')
	const maskedCards = maskValue(cards, mask, 'board')
	// Rebuild `cards` in sorted key order: the original insertion order is the
	// mint order, which would tie each alias back to its real id.
	const sortedCards: GameState['cards'] = {}
	for (const key of Object.keys(maskedCards).sort()) {
		sortedCards[key] = maskedCards[key]!
	}
	const history = maskValue({ log, fx, resolvedOps }, mask, 'history')
	const view: GameState = {
		...maskedBoard,
		cards: sortedCards,
		log: history.log,
		fx: history.fx,
	}
	if (history.resolvedOps !== undefined) view.resolvedOps = history.resolvedOps
	return view as unknown as ProjectedState
}

// ---------------------------------------------------------------------------
// Reveal detection (the online undo floor)
// ---------------------------------------------------------------------------

/**
 * How many random draws (`next()` calls — shuffles, random picks) happened
 * between `before` and the `after` that one `reduce` produced.
 *
 * `rng.counter` also serves as the nonce for choice ids: publishing a
 * PendingChoice bumps it by one (runtime.suspend, phases.phaseSuspend and the
 * reaction window are the only `nextRng` callers), and a reduce halts on at
 * most one newly published choice. So the draws are the counter delta minus
 * that one publication. A shuffle of one card draws nothing — correctly, it
 * randomised nothing.
 */
export function rngDraws(before: GameState, after: GameState): number {
	const delta = after.rng.counter - before.rng.counter
	const published =
		after.pendingChoice !== null &&
		after.pendingChoice.id !== before.pendingChoice?.id
			? 1
			: 0
	return Math.max(0, delta - published)
}

/** Cards whose face was hidden from `seat` in `before` and is visible in
 *  `after` — a draw, a scan or look, a reveal to the Market, a card moving
 *  from a hand to a public zone. Once seen it cannot be unseen. */
export function revealedCards(
	before: GameState,
	after: GameState,
	seat: Seat,
): CardInstanceId[] {
	const was = hiddenCards(before, seat)
	const now = hiddenCards(after, seat)
	const out: CardInstanceId[] = []
	for (const iid of was) {
		if (!now.has(iid) && after.cards[iid] !== undefined) out.push(iid)
	}
	return out.sort()
}
