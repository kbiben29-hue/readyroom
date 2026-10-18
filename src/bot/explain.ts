// Why the house AI played what it played (todo/15 §4, the UI's AI move ticker
// and "Why?" panel). A bot that implements `Bot.decideExplained` returns its
// move together with a `DecisionInfo`: the few options it weighed, best first,
// with the number it ranked them by. Building it reuses what the decision
// already computed (the heuristic's candidate scores, the search's root
// edges): it never runs an extra search, and `decideExplained(...).intent` is
// always exactly `decide(...)`'s answer.
//
// Plain JSON (it crosses the worker boundary and sits in the UI store). The
// intents are the engine's own; the UI labels them, resolves card names from
// the STCC data at render time and masks what the viewer may not see
// (src/ui/botMoves.ts). Nothing here names a card.

import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import type { Seat } from '../engine/resolver/queries'
import type { Bot, BotId } from './types'

/** How a decision was made:
 *  - `search`: the ISMCTS search (Hard), ranked by visits;
 *  - `heuristic`: the one-decision lookahead (Easy / Normal), ranked by score;
 *  - `forced`: one sensible option only, nothing was weighed;
 *  - `rule`: a fixed rule decided it (a completable mission, first-legal). */
export type DecisionKind = 'search' | 'heuristic' | 'forced' | 'rule'

export interface DecisionOption {
	intent: Intent
	/** An id-free label the bot may attach (the UI labels intents itself). */
	label?: string | undefined
	/** The option's value as an expected VP margin for the deciding seat
	 *  (heuristic: the candidate score; search: the edge's mean value mapped
	 *  back from tanh space). */
	score: number
	/** Search only: the option's share of the root visits, in [0, 1]. */
	share?: number | undefined
	chosen: boolean
}

export interface DecisionInfo {
	botId: BotId
	kind: DecisionKind
	/** The top options, best first (at most MAX_OPTIONS, the chosen one always
	 *  included). Empty for a forced or rule decision. */
	options: DecisionOption[]
	/** Search iterations run (search only). */
	iterations?: number | undefined
	/** Wall-clock time of the decision in ms (filled in by the runner). */
	ms?: number | undefined
	/** A one-line reason for a forced or rule decision. */
	note?: string | undefined
}

/** How many options a DecisionInfo keeps. */
export const MAX_OPTIONS = 4

export const NOTE_FORCED = 'only one legal option'
export const NOTE_MISSION = 'completable mission taken immediately'
export const NOTE_FIRST_LEGAL = 'plays the first legal option'
export const NOTE_EASY = 'Easy picks at random, weighted by these scores'

/** A forced / rule DecisionInfo. */
export function ruleInfo(
	botId: BotId,
	kind: 'forced' | 'rule',
	note: string,
): DecisionInfo {
	return { botId, kind, options: [], note }
}

/**
 * The top `MAX_OPTIONS` of `rows` by `rank` (descending, ties keep the input
 * order), always including the chosen row (it replaces the last kept one when
 * it ranks lower).
 */
export function topOptions(
	rows: readonly DecisionOption[],
	rank: (o: DecisionOption) => number,
	max = MAX_OPTIONS,
): DecisionOption[] {
	const order = rows
		.map((o, i) => ({ o, i }))
		.sort((a, b) => rank(b.o) - rank(a.o) || a.i - b.i)
		.map((x) => x.o)
	const top = order.slice(0, max)
	if (!top.some((o) => o.chosen)) {
		const chosen = order.find((o) => o.chosen)
		if (chosen !== undefined) top[top.length - 1] = chosen
	}
	return top
}

/** Map a search value v = tanh(margin / scale) back to a VP margin (clamped
 *  so a near-certain win stays finite). */
export function marginOfValue(v: number, scale: number): number {
	if (!Number.isFinite(v)) return 0
	const c = Math.max(-0.995, Math.min(0.995, v))
	return scale * Math.atanh(c)
}

/** The decision and its explanation for any bot: `decideExplained` when the
 *  bot has it, else `decide` with a rule note. */
export function explainDecision(
	bot: Bot,
	state: GameState,
	seat: Seat,
	legal: Intent[],
): { intent: Intent; info: DecisionInfo } {
	if (bot.decideExplained !== undefined)
		return bot.decideExplained(state, seat, legal)
	const intent = bot.decide(state, seat, legal)
	return {
		intent,
		info: ruleInfo(
			bot.id,
			legal.length <= 1 ? 'forced' : 'rule',
			legal.length <= 1 ? NOTE_FORCED : NOTE_FIRST_LEGAL,
		),
	}
}
