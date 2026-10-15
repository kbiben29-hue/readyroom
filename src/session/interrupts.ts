// Interrupt rules of the async online mode (docs/ui-mobile.md §7). An
// interrupt is a PendingChoice owed by the seat that is NOT moving — a
// REACTION window or a FORCE/OPPONENT choice on the opponent's turn. The
// server (server/games.ts) answers some of them without the player:
//
//   - standing orders: per seat and reaction card def, `always` takes the
//     reaction (and the bot heuristic makes any sub-choice its effect asks
//     that seat), `never` declines it, `ask` (default) waits for the player;
//   - the deadline default: decline an optional reaction window / confirm,
//     otherwise the engine's firstLegalSelection.
//
// Pure functions of the state (no clock, no I/O); the server decides WHEN.
// Standing orders deliberately only act on interrupts: on your own turn you
// are at the table, so you are asked.

import type { GameState } from '../engine/state'
import type { Seat } from '../engine/resolver/queries'
import type { PendingChoice } from '../engine/resolver/choices'
import { checkSelection } from '../engine/resolver/choices'
import { firstLegalSelection } from '../engine/intents'
import { firstLegalPolicy } from '../bot/autoPlay'
import type { StandingOrders, StandingPolicy } from './protocol'

/** Whose input the game waits on: the pending choice's seat, else the active
 *  seat; null once the game is over. */
export function decisionSeat(state: GameState): Seat | null {
	if (state.result !== null) return null
	return state.pendingChoice?.seat ?? state.activeSeat
}

/** The interrupt currently open, if any (a choice owed by the non-mover). */
export function interruptChoice(state: GameState): PendingChoice | null {
	const choice = state.pendingChoice
	if (state.result !== null || choice === null) return null
	return choice.seat === state.activeSeat ? null : choice
}

/** A standing order's policy for a card instance (by its def). */
export function policyFor(
	state: GameState,
	orders: StandingOrders,
	iid: string,
): StandingPolicy {
	const def = state.cards[iid]?.def
	return def === undefined ? 'ask' : (orders[def] ?? 'ask')
}

/** The bot heuristic a standing order `always` uses for sub-choices: the
 *  first-legal policy (src/bot/autoPlay.ts), except that a "you may" inside
 *  the reaction is accepted — the player asked to always use the card. */
export function standingOrderPolicy(
	state: GameState,
	choice: PendingChoice,
): unknown {
	if (choice.k === 'CONFIRM') return true
	return firstLegalPolicy(state, choice)
}

/** `selection` if the choice accepts it, else the engine's probed first legal
 *  selection (the same defence-in-depth autoPlay uses). */
function validOr(state: GameState, selection: unknown): unknown {
	const choice = state.pendingChoice
	if (choice !== null && checkSelection(choice, selection).ok) return selection
	return firstLegalSelection(state)
}

/**
 * The selection the owing seat's standing orders give the open interrupt, or
 * undefined when the player must be asked.
 *
 * - A reaction window (OPTIONAL_TRIGGERS): take every offered reaction whose
 *   card is `always` (the engine re-offers the rest afterwards, if still
 *   legal); decline when every offered one is `never`; otherwise ask.
 * - Any other choice owed by the seat whose source is one of its own cards
 *   ordered `always` (a sub-choice of a reaction the order took): answer with
 *   `standingOrderPolicy`.
 */
export function standingOrderAnswer(
	state: GameState,
	orders: readonly [StandingOrders, StandingOrders],
): { selection: unknown } | undefined {
	const choice = interruptChoice(state)
	if (choice === null) return undefined
	const own = orders[choice.seat]
	if (choice.k === 'OPTIONAL_TRIGGERS') {
		const always = choice.offered.filter(
			(ref) => policyFor(state, own, ref.card) === 'always',
		)
		if (always.length > 0)
			return {
				selection: validOr(
					state,
					always.map((ref) => ({ ...ref })),
				),
			}
		if (
			choice.offered.every((ref) => policyFor(state, own, ref.card) === 'never')
		)
			return { selection: [] }
		return undefined
	}
	const source = choice.sourceCard
	if (source === null) return undefined
	const card = state.cards[source]
	if (card === undefined || card.owner !== choice.seat) return undefined
	if ((own[card.def] ?? 'ask') !== 'always') return undefined
	return { selection: validOr(state, standingOrderPolicy(state, choice)) }
}

/** The safe default the server applies when an interrupt's deadline passes:
 *  decline an optional reaction window or a "you may", otherwise the engine's
 *  first legal selection. */
export function timeoutSelection(state: GameState): unknown {
	const choice = state.pendingChoice
	if (choice === null) return null
	switch (choice.k) {
		case 'OPTIONAL_TRIGGERS':
			return validOr(state, [])
		case 'CONFIRM':
			return validOr(state, false)
		default:
			return firstLegalSelection(state)
	}
}
