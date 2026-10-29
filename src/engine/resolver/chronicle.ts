// Log lines for the events that take something off the table — a card
// dismissed, destroyed or logged, an opponent's Away Teams removed. Primitives
// and moveCard's cascades only queue these as GameEvents (for the triggers);
// without a line in the log the move left no trace a player could read, and
// a card simply vanished from the board. runCollecting calls `chronicle` once
// per primitive step, before the queue is drained, with the seat that step
// resolved for.

import type { Seat } from './queries'
import type { Frame, GameEvent, GameState, LogEntry } from '../state'
import { addLog } from './runtime'

/** The seat a frame resolves for: its effect context's actor, a reaction
 *  window's seat, otherwise the active seat. */
export function frameActor(state: GameState, frame: Frame | undefined): Seat {
	switch (frame?.k) {
		case 'EFFECT':
		case 'OPERATION':
			return frame.ctx.actor
		case 'REACTION_WINDOW':
			return frame.seat
		case 'PHASE_STEP':
			return frame.ctx?.actor ?? state.activeSeat
		default:
			return state.activeSeat
	}
}

function entryFor(
	state: GameState,
	ev: GameEvent,
	actor: Seat,
): LogEntry | null {
	switch (ev.k) {
		case 'CARD_DISMISSED':
		case 'CARD_DESTROYED':
		case 'CARD_LOGGED': {
			const verb =
				ev.k === 'CARD_DISMISSED'
					? 'dismissed'
					: ev.k === 'CARD_DESTROYED'
						? 'destroyed'
						: 'logged'
			const owner = state.cards[ev.iid]?.owner ?? null
			return {
				kind: 'EVENT',
				seat: actor,
				message: `${verb} ${ev.iid}`,
				iid: ev.iid,
				...(owner !== null ? { about: owner } : {}),
			}
		}
		case 'AWAY_TEAM_REMOVED': {
			// your own Away Teams coming home (a move, a Location you took control
			// of) is bookkeeping; the opponent's are what the line is for
			if (ev.seat === actor || ev.count <= 0) return null
			// `location` is an instance id or, from REMOVE_AWAY_TEAM, a def id
			const loc =
				state.cards[ev.location] !== undefined
					? ev.location
					: `[[card:${ev.location}]]`
			return {
				kind: 'EVENT',
				seat: actor,
				message: `removed ${ev.count} opponent Away Team${ev.count === 1 ? '' : 's'} from ${loc}`,
				about: ev.seat,
			}
		}
		default:
			return null
	}
}

/** Append a log line for each queued event that took something off the
 *  table. Probe mode records nothing. */
export function chronicle(state: GameState, actor: Seat): GameState {
	if (state.probe === true) return state
	let next = state
	for (const ev of state.eventQueue) {
		const entry = entryFor(next, ev, actor)
		if (entry !== null) next = addLog(next, entry)
	}
	return next
}
