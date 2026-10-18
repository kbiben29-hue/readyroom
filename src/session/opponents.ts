// House-AI seats of a local game (todo/15 §4). A session may name a bot per
// seat in `session.opponents`; a seat without an entry is a human at the
// device. The engine and SetupConfig stay bot-unaware: the bots only ever
// answer through ordinary intents in the log, so a bot game replays, undoes
// and exports exactly like a hot-seat game.
//
// This is the HOUSE AI, not the official solo Bot (that needs the separate
// solo rulebook, docs/open-questions.md Blocker B2).

import type { BotId } from '../bot/types'
import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import { reduce } from '../engine/intents'
import type { CardCatalog } from '../engine/setup'
import { setup } from '../engine/setup'
import type { Seat } from '../engine/resolver/queries'
import { decisionSeat } from './interrupts'

/** The bot per seat (absent = human). Keyed by seat; JSON turns the keys
 *  into strings, which index the same in JS. */
export type Opponents = Partial<Record<Seat, BotId>>

export const BOT_IDS: readonly BotId[] = [
	'first-legal',
	'easy',
	'normal',
	'hard',
]

/** The levels offered on the setup screen (first-legal is a test driver). */
export const BOT_LEVELS: readonly BotId[] = ['easy', 'normal', 'hard']

export const BOT_LEVEL_LABEL: Record<BotId, string> = {
	'first-legal': 'First legal',
	easy: 'Easy',
	normal: 'Normal',
	hard: 'Hard',
}

export function isBotId(v: unknown): v is BotId {
	return typeof v === 'string' && (BOT_IDS as readonly string[]).includes(v)
}

/** A stored `opponents` value cleaned to its valid entries, or undefined when
 *  none is left (malformed or absent). */
export function parseOpponents(raw: unknown): Opponents | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined
	const src = raw as Record<string, unknown>
	const out: Opponents = {}
	for (const seat of [0, 1] as const) {
		const v = src[String(seat)]
		if (isBotId(v)) out[seat] = v
	}
	return out[0] === undefined && out[1] === undefined ? undefined : out
}

/** The bot playing `seat`, if any. */
export function botFor(
	opponents: Opponents | undefined,
	seat: Seat,
): BotId | undefined {
	return opponents?.[seat]
}

/** The human seats of a game (both, in hot-seat). */
export function humanSeats(opponents: Opponents | undefined): Seat[] {
	return ([0, 1] as const).filter((s) => botFor(opponents, s) === undefined)
}

export function hasBots(opponents: Opponents | undefined): boolean {
	return humanSeats(opponents).length < 2
}

/** Both seats are bots: a spectator game. */
export function isSpectator(opponents: Opponents | undefined): boolean {
	return humanSeats(opponents).length === 0
}

/** "House AI (Normal)" */
export function botLabel(id: BotId): string {
	return `House AI (${BOT_LEVEL_LABEL[id]})`
}

/** Load-list line: "vs House AI (Normal)", "House AI (Easy) vs House AI
 *  (Hard)", or null for a hot-seat game. */
export function opponentsLabel(
	opponents: Opponents | undefined,
): string | null {
	const a = botFor(opponents, 0)
	const b = botFor(opponents, 1)
	if (a === undefined && b === undefined) return null
	if (a !== undefined && b !== undefined)
		return `${botLabel(a)} vs ${botLabel(b)}`
	return `vs ${botLabel((a ?? b)!)}`
}

/** Who decided each logged intent: `decisionSeat` of the state it was
 *  dispatched in (one replay). The undo policy of a bot game needs it. */
export function decidersOf(
	config: Parameters<typeof setup>[0],
	log: readonly Intent[],
	catalog: CardCatalog,
): Seat[] {
	let state: GameState = setup(config, catalog)
	const out: Seat[] = []
	for (const intent of log) {
		out.push(decisionSeat(state) ?? state.activeSeat)
		state = reduce(state, intent).state
	}
	return out
}
