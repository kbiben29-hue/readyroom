// The bot interface (house AI, todo/15 §4). Every opponent the project ships
// (the first-legal driver, the heuristic Easy/Normal/Hard levels, a later
// ISMCTS search and learned value function) is a `Bot`: a pure function from
// a game state to the intent the bot's seat plays next.
//
// This is a HOUSE AI, not the official solo Bot (that needs the separate solo
// rulebook — docs/open-questions.md Blocker B2).

import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import type { Seat } from '../engine/resolver/queries'

/** The registered bot levels (src/bot/index.ts `makeBot`).
 *  - `first-legal`: the deterministic fuzz driver (src/bot/autoPlay.ts).
 *  - `easy`: the heuristic with softmax noise over its candidate scores.
 *  - `normal`: the heuristic, argmax.
 *  - `hard`: the ISMCTS search (src/bot/ismcts.ts). */
export type BotId = 'first-legal' | 'easy' | 'normal' | 'hard'

/**
 * A synchronous, deterministic, pure opponent.
 *
 * `decide(state, seat, legal)` returns the intent `seat` plays next. `legal` is
 * `legalIntents(state)` (with a pending choice it holds a single
 * RESOLVE_CHOICE carrying the engine's first legal selection). The caller
 * validates the result: a top-level intent must be one of `legal`, a
 * RESOLVE_CHOICE must pass `validateChoice`. Callers fall back to the
 * first-legal answer otherwise (src/bot/autoPlay.ts `playBots`).
 *
 * **No-cheat contract.** `decide` gets the FULL state, because simulating
 * needs the effect stack and the rng, and `seatView` clears both. It must
 * still play as if it only saw `seatView(state, seat)`:
 *   - hidden information (the opponent's hand and Captain's Log, every
 *     face-down deck's order and the shared decks' contents) may only be read
 *     through `determinize(state, seat, rng)` (src/bot/determinize.ts), which
 *     resamples it;
 *   - any randomness is seeded from `seedFromView(state, seat)`, never from
 *     `state.rng`;
 * so the result is a function of the seat's information set only. Two states
 * that differ only in the hidden arrangement yield the same intent
 * (determinize.test.ts asserts this for the heuristic).
 *
 * `decide` must not mutate `state`; use `forkState` (src/engine/state.ts)
 * before running the engine on a state you want to branch from again.
 */
export interface Bot {
	id: BotId
	decide(state: GameState, seat: Seat, legal: Intent[]): Intent
}

/** The asynchronous face of a bot, e.g. one running in a Web Worker. Same
 *  contract as `Bot`, the answer just arrives later. */
export interface AsyncBot {
	id: BotId
	decide(state: GameState, seat: Seat, legal: Intent[]): Promise<Intent>
}

/** Wrap a synchronous bot as an AsyncBot (resolves on a microtask; a thrown
 *  error becomes a rejection). */
export function toAsync(bot: Bot): AsyncBot {
	return {
		id: bot.id,
		decide: (state, seat, legal) =>
			new Promise<Intent>((resolve) => resolve(bot.decide(state, seat, legal))),
	}
}
