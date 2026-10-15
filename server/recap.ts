// "Previously on…" (docs/ui-mobile.md §5): what happened since a seat's last
// own turn, rebuilt from the intent log — each intent with the engine log
// lines and events it produced, projected for the requesting seat, plus the
// public totals before and after for the four deltas on top.
//
// Hidden cards are named by the opaque HIDDEN_IID, never by position: a card
// counts as hidden in an entry when the requester cannot see it once that
// intent resolved (a played card is always public — it passes through the
// Staging Area). Replays from the seed, so it runs on the server only.

import type { CardCatalog, SetupConfig } from '../src/engine/setup'
import { setup } from '../src/engine/setup'
import type { GameState } from '../src/engine/state'
import type { Seat } from '../src/engine/resolver/queries'
import { reduce } from '../src/engine/intents'
import { countIncidents } from '../src/engine/endgame'
import { hiddenCards } from '../src/engine/projection'
import { HIDDEN_IID, maskValue, type SeatMask } from '../src/engine/seatView'
import { estimateScore } from '../src/session/log'
import type { Recap, RecapEntry, RecapTotals } from '../src/session/protocol'
import type { LoggedIntent } from './gameStore'

/** The default recap start for `seat`: the end of its latest own turn that
 *  the opponent has played after (0 = from the beginning). */
export function defaultSinceSeq(
	log: readonly LoggedIntent[],
	seat: Seat,
): number {
	let i = log.length - 1
	while (i >= 0 && log[i]!.active === seat) i-- // the seat's current turn
	while (i >= 0 && log[i]!.active !== seat) i-- // the opponent's turn(s)
	return i >= 0 ? log[i]!.seq : 0
}

/** Public numbers for the recap deltas, as `viewer` may know them. */
export function recapTotals(state: GameState, viewer: Seat): RecapTotals {
	return {
		turn: state.turnNumber,
		vp: [estimateScore(state, 0, viewer), estimateScore(state, 1, viewer)],
		glory: [state.players[0].resources.GLO, state.players[1].resources.GLO],
		stardateGlory: state.stardates.gloryOnTop,
		incidentDeck: state.zones['INCIDENT_DECK']?.length ?? 0,
		incidents: [countIncidents(state, 0), countIncidents(state, 1)],
	}
}

function historyMask(seat: Seat, hidden: Iterable<string>): SeatMask {
	const toAlias = new Map<string, string>()
	for (const iid of hidden) toAlias.set(iid, HIDDEN_IID)
	return { seat, toAlias, toReal: new Map() }
}

export interface BuildRecapOptions {
	gameId: string
	version: number
	config: SetupConfig
	catalog: CardCatalog
	log: readonly LoggedIntent[]
	seat: Seat
	/** explicit start: entries with seq > since (all seats); default = since
	 *  the seat's last own turn, the opponent's entries only */
	since?: number | undefined
}

export function buildRecap(opts: BuildRecapOptions): Recap {
	const { seat, log } = opts
	const explicit = opts.since !== undefined
	const sinceSeq = explicit
		? Math.max(0, Math.min(opts.since!, log.length))
		: defaultSinceSeq(log, seat)
	let state = setup(opts.config, opts.catalog)
	for (const entry of log) {
		if (entry.seq > sinceSeq) break
		state = reduce(state, entry.intent).state
	}
	const before = recapTotals(state, seat)
	const entries: RecapEntry[] = []
	for (const entry of log) {
		if (entry.seq <= sinceSeq) continue
		const prev = state
		const result = reduce(prev, entry.intent)
		state = result.state
		if (!explicit && entry.active === seat) continue
		entries.push(recapEntry(entry, prev, state, result.events, seat))
	}
	return {
		gameId: opts.gameId,
		seat,
		version: opts.version,
		sinceSeq,
		toSeq: log.length,
		entries,
		before,
		after: recapTotals(state, seat),
	}
}

function recapEntry(
	entry: LoggedIntent,
	before: GameState,
	after: GameState,
	events: GameState['eventQueue'],
	seat: Seat,
): RecapEntry {
	// Hidden = hidden once the intent resolved, even if the card was public
	// before: inside one intent a public discard can be reshuffled and drawn,
	// and naming the drawn card would say which one it was.
	const hidden: Set<string> = hiddenCards(after, seat)
	const intent = entry.intent
	let card: RecapEntry['card'] = null
	if (intent.t === 'PLAY_CARD' || intent.t === 'ACTIVATE') {
		hidden.delete(intent.iid) // played / activated cards are public
		const def = before.cards[intent.iid]?.def
		if (def !== undefined) card = { iid: intent.iid, def }
	}
	const mask = historyMask(seat, hidden)
	let choice: RecapEntry['choice'] = null
	const asked = before.pendingChoice
	if (intent.t === 'RESOLVE_CHOICE' && asked !== null) {
		const source = asked.sourceCard
		const sourceVisible = source === null || !hidden.has(source)
		choice = {
			kind: asked.k,
			prompt: maskValue(asked.prompt, mask, 'history'),
			sourceDef: sourceVisible
				? (asked.sourceDef ??
					(source === null ? null : (before.cards[source]?.def ?? null)))
				: null,
		}
	}
	return {
		seq: entry.seq,
		seat: entry.seat,
		by: entry.by,
		at: entry.at,
		turn: entry.turn,
		activeSeat: entry.active,
		yours: entry.seat === seat,
		intent: maskValue(intent, mask, 'history'),
		card,
		choice,
		log: maskValue(after.log.slice(before.log.length), mask, 'history'),
		events: maskValue(events, mask, 'history'),
	}
}
