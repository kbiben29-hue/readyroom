// Wire protocol of the authoritative async game service (server/games.ts,
// server/README.md; docs/ui-mobile.md §7). Types only — shared by the server
// and the client (src/session/online.ts), so the phone UI and the server can
// never disagree on a payload shape. Nothing here carries the seed or a
// hidden card: every state is a seat view (src/engine/seatView.ts).

import type { Intent } from '../engine/intents'
import type { ProjectedState } from '../engine/projection'
import type { PendingChoice } from '../engine/resolver/choices'
import type { Seat } from '../engine/resolver/queries'
import type { GameEvent, LogEntry } from '../engine/state'
import type { DeckId } from '../data/ids'
import type { BoardSide } from './log'

export type { Seat, Intent, ProjectedState }

/** What a seat's standing order does when a REACTION of that card is offered
 *  on the opponent's turn: ask (default — the decision waits for you, with a
 *  deadline), always (the server takes it; the bot heuristic makes any
 *  sub-choice), never (the server declines it). */
export type StandingPolicy = 'ask' | 'always' | 'never'

/** Per seat: card def id → policy. Absent = 'ask'. Only its own seat sees it. */
export type StandingOrders = Record<string, StandingPolicy>

/** Who put an intent into the log: the seat's player, its standing order, the
 *  deadline default, or the server itself (the opening START). */
export type SubmittedBy = 'player' | 'order' | 'timeout' | 'server'

export type GameStatus = 'ACTIVE' | 'COMPLETE'

export interface SeatInfo {
	seat: Seat
	deck: DeckId
	/** the captain's name (session/log.ts deckName) */
	deckName: string
	boardSide: BoardSide
	/** optional display name given at creation */
	name: string | null
}

export interface GameSettings {
	/** How long the seat that owes an interrupt decision has before the server
	 *  applies the safe default. Default 12 hours. */
	deadlineMs: number
}

/**
 * An interrupt: a decision owed by the seat that is NOT moving (a reaction
 * window or a FORCE/OPPONENT choice on the opponent's turn). The mover's own
 * decisions never have a deadline.
 */
export interface PendingDecision {
	seat: Seat
	kind: PendingChoice['k']
	choiceId: string
	prompt: string
	/** the card whose effect asks — null when it is hidden from the viewer */
	sourceDef: string | null
	/** ISO timestamps */
	since: string
	deadline: string
}

export interface GameResultSummary {
	kind: 'BURN' | 'FINAL_SCORING' | 'COMPLETE'
	winners: Seat[]
}

/** Everything one seat needs to render and act — GET /games/:id. */
export interface GameView {
	gameId: string
	/** the seat this view is for (the token's seat) */
	seat: Seat
	/** optimistic-concurrency version: submit it back with every intent */
	version: number
	status: GameStatus
	players: [SeatInfo, SeatInfo]
	settings: GameSettings
	/** the seat view: hidden cards are HIDDEN_DEF under `hidden:<zone>:<i>`
	 *  aliases, no RNG, no stack, only this seat's own pending choice */
	state: ProjectedState
	/** whose input the game waits on (pending choice's seat, else the active
	 *  seat); null once the game is over */
	toMove: Seat | null
	yourMove: boolean
	/** what this seat may submit now (empty unless yourMove). The pending
	 *  choice's RESOLVE_CHOICE carries a default selection — replace it. */
	legalIntents: Intent[]
	/** the interrupt currently owed by the non-moving seat, if any */
	pending: PendingDecision | null
	/** undo is allowed right now (your turn, your last intent, nothing new
	 *  revealed to you since) */
	canUndo: boolean
	/** this seat's standing orders */
	orders: StandingOrders
	/** which seats hold an open event stream ("on the bridge") */
	presence: [boolean, boolean]
	intentCount: number
	/** ISO timestamp of the last change */
	lastActivity: string
	result: GameResultSummary | null
}

/** One inbox row — POST /games/summaries. */
export interface GameSummary {
	gameId: string
	seat: Seat
	version: number
	status: GameStatus
	players: [SeatInfo, SeatInfo]
	toMove: Seat | null
	yourMove: boolean
	activeSeat: Seat
	/** the interrupt owed by THIS seat, with its deadline */
	pendingOnYou: PendingDecision | null
	/** any interrupt (either seat) */
	pending: PendingDecision | null
	/** public running VP estimate per seat (session/log.ts estimateScore) */
	score: [number, number]
	turn: number
	phase: string
	stardate: { def: string | null; name: string | null; remaining: number }
	result: GameResultSummary | null
	lastActivity: string
	presence: [boolean, boolean]
	/** ISO time each seat was last seen (any request or open stream);
	 *  in-memory, so null after a server restart */
	lastSeen: [string | null, string | null]
}

export interface SummaryError {
	gameId: string
	status: number
	code: string
	error: string
}

/** The public numbers a "Previously on…" screen shows deltas of. */
export interface RecapTotals {
	turn: number
	vp: [number, number]
	glory: [number, number]
	stardateGlory: number
	incidentDeck: number
	incidents: [number, number]
}

/** One intent of the recap, projected for the requesting seat. */
export interface RecapEntry {
	seq: number
	/** who decided it */
	seat: Seat
	by: SubmittedBy
	/** ISO time it was applied */
	at: string
	/** turn number and active seat when it was applied */
	turn: number
	activeSeat: Seat
	/** decided by the requesting seat (an interrupt answer / standing order) */
	yours: boolean
	/** the intent, hidden cards named `hidden` */
	intent: Intent
	/** the played / activated card, when the requester can know it */
	card: { iid: string; def: string } | null
	/** the choice a RESOLVE_CHOICE answered */
	choice: {
		kind: PendingChoice['k']
		prompt: string
		sourceDef: string | null
	} | null
	/** engine log lines this intent produced */
	log: LogEntry[]
	/** engine events this intent emitted */
	events: GameEvent[]
}

/** GET /games/:id/recap — what happened since the seat's last own turn (or
 *  since `?since=<seq>`). */
export interface Recap {
	gameId: string
	seat: Seat
	version: number
	/** entries have seq > sinceSeq */
	sinceSeq: number
	/** seq of the newest entry (= intent count) */
	toSeq: number
	entries: RecapEntry[]
	before: RecapTotals
	after: RecapTotals
}

// ---------------------------------------------------------------------------
// Requests / responses
// ---------------------------------------------------------------------------

export interface CreateSeatRequest {
	deck: DeckId
	boardSide: BoardSide
	name?: string | undefined
}

export interface CreateGameRequest {
	players: [CreateSeatRequest, CreateSeatRequest]
	settings?: { deadlineMs?: number | undefined } | undefined
}

/**
 * POST /games with `host` instead of `players` — an invite: only the host's
 * captain is chosen. The host holds seat 0; the invite link carries seat 1,
 * whose holder picks a captain on joining (POST /games/:id/join) and takes the
 * first turn — they are the one at the screen right then.
 */
export interface CreateOpenGameRequest {
	host: CreateSeatRequest
	settings?: { deadlineMs?: number | undefined } | undefined
}

/** POST /games/:id/join — the guest's captain. */
export type JoinGameRequest = CreateSeatRequest

/** The game has started and it is the guest's move. Joining retires the
 *  invite token (the host saw it, and a link can travel): `token` is the
 *  guest's seat from now on — keep it, the link no longer opens anything. */
export interface JoinGameResponse {
	token: string
	view: GameView
}

/**
 * GET /games/:id/lobby — what a seat token may know before (or instead of)
 * the full view: whether the game waits for its guest, and who hailed. Works
 * on open and started games alike, so an invite link can decide between the
 * join screen and the game.
 */
export interface GameLobby {
	gameId: string
	/** the token's seat */
	seat: Seat
	/** OPEN = waiting for the guest to pick a captain */
	status: 'OPEN' | GameStatus
	/** seat 0 of an invite; for a started game, both seats */
	players: [SeatInfo, SeatInfo | null]
	settings: GameSettings
	createdAt: string
	lastActivity: string
	/** which seats hold an open event stream */
	presence: [boolean, boolean]
}

export interface CreateGameResponse {
	gameId: string
	/** one secret per seat; the server stores only their hashes — keep them */
	tokens: [string, string]
	version: number
}

export interface SubmitIntentRequest {
	intent: Intent
	version: number
}

export interface UndoRequest {
	version: number
}

export interface StandingOrderRequest {
	cardDef: string
	policy: StandingPolicy
}

export interface SeatCredentials {
	gameId: string
	token: string
}

export interface SummariesRequest {
	games: SeatCredentials[]
}

export interface SummariesResponse {
	summaries: GameSummary[]
	/** invites no guest has answered yet (the host's own rows) */
	open?: GameLobby[] | undefined
	errors: SummaryError[]
}

/** Error body of every non-2xx game response. */
export interface ErrorBody {
	ok: false
	code: ErrorCode
	error: string
	/** STALE_VERSION: the current version */
	version?: number | undefined
}

export type ErrorCode =
	| 'BAD_REQUEST'
	| 'UNAUTHORIZED'
	| 'NOT_FOUND'
	| 'NOT_YOUR_DECISION'
	| 'STALE_VERSION'
	| 'ILLEGAL_INTENT'
	| 'UNDO_REFUSED'
	| 'GAME_OVER'
	| 'NOT_STARTED'
	| 'ALREADY_STARTED'
	| 'TOO_LARGE'
	| 'INTERNAL'

// ---------------------------------------------------------------------------
// Server-Sent Events — GET /games/:id/events?token=…
// ---------------------------------------------------------------------------

export interface HelloStreamEvent {
	type: 'hello'
	gameId: string
	seat: Seat
	version: number
	presence: [boolean, boolean]
}

/** Sent on every version bump (an intent, an undo, a standing-order answer,
 *  a timeout). Refetch the view when `version` is newer than yours. */
export interface VersionStreamEvent {
	type: 'version'
	gameId: string
	version: number
	toMove: Seat | null
	activeSeat: Seat
	pending: PendingDecision | null
	status: GameStatus
	lastActivity: string
}

export interface PresenceStreamEvent {
	type: 'presence'
	gameId: string
	presence: [boolean, boolean]
}

export type GameStreamEvent =
	HelloStreamEvent | VersionStreamEvent | PresenceStreamEvent

export const STREAM_EVENT_TYPES = ['hello', 'version', 'presence'] as const
