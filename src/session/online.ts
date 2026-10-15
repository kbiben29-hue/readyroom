// Client for the authoritative async game service (server/games.ts,
// server/README.md; docs/ui-mobile.md §7). The phone UI holds seat
// credentials `{ gameId, token }` locally (no accounts) and talks to the
// server only through this class:
//
//   const client = new OnlineGameClient({ baseUrl: 'https://bridge.example' })
//   const game = await client.createInvite({ host: pic })
//   const mine = game.host                                    // keep locally
//   share(inviteLink(location.origin + '/play', game.invite)) // the friend
//
//   // the friend, from the link: pick a captain — the game starts, their move
//   const { seat, view } = await client.joinGame(game.invite, shr)  // keep seat
//
//   const sub = client.watch(mine, (view) => render(view))    // live view
//   await client.submitIntent(mine, intent, view.version)     // play
//   sub.close()
//
// Every state it receives is a seat view: hidden cards are HIDDEN_DEF under
// `hidden:<zone>:<index>` aliases (submit those aliases back as-is when a
// choice offers them), no RNG, only this seat's pending choice. Derive what is
// playable from `view.legalIntents`, never by running engine queries on the
// view (hidden defs cannot be evaluated).
//
// Concurrency: every write carries the view's `version`; a stale one fails
// with OnlineError code 'STALE_VERSION' (409) — refetch and retry.
//
// Test seams: `fetchImpl` and `eventSource` are injectable, like
// src/session/remote.ts. Nothing here touches the DOM or node built-ins.

import type { Intent } from '../engine/intents'
import type {
	CreateGameRequest,
	CreateGameResponse,
	CreateOpenGameRequest,
	ErrorCode,
	GameLobby,
	GameStreamEvent,
	GameView,
	Recap,
	JoinGameRequest,
	JoinGameResponse,
	SeatCredentials,
	StandingPolicy,
	SummariesResponse,
} from './protocol'
import { STREAM_EVENT_TYPES } from './protocol'

export type * from './protocol'
export { STREAM_EVENT_TYPES } from './protocol'

/** The subset of the browser EventSource the client uses. */
export interface EventSourceLike {
	readonly readyState: number
	onopen: ((ev: unknown) => void) | null
	onerror: ((ev: unknown) => void) | null
	addEventListener(
		type: string,
		listener: (ev: { data: string; lastEventId?: string }) => void,
	): void
	close(): void
}

export type EventSourceFactory = (url: string) => EventSourceLike

export interface ReconnectOptions {
	/** first retry delay (default 1 s), doubled per failure… */
	initialDelayMs?: number | undefined
	/** …up to this (default 30 s); reset once a stream opens */
	maxDelayMs?: number | undefined
}

export interface OnlineClientOptions {
	/** server origin, e.g. `http://127.0.0.1:8787` */
	baseUrl: string
	/** test seam — defaults to the global fetch */
	fetchImpl?: typeof fetch | undefined
	/** test seam — defaults to `new EventSource(url)` */
	eventSource?: EventSourceFactory | undefined
	reconnect?: ReconnectOptions | undefined
}

/** A refused request: HTTP status + the server's error code. */
export class OnlineError extends Error {
	readonly status: number
	readonly code: ErrorCode | 'NETWORK'
	/** STALE_VERSION: the server's current version */
	readonly version: number | undefined
	constructor(
		status: number,
		code: ErrorCode | 'NETWORK',
		message: string,
		version?: number,
	) {
		super(message)
		this.name = 'OnlineError'
		this.status = status
		this.code = code
		this.version = version
	}
}

export const isStaleVersion = (err: unknown): err is OnlineError =>
	err instanceof OnlineError && err.code === 'STALE_VERSION'

/** Both seats of a new game. Keep the one you play; invite with the other. */
export interface CreatedGame {
	gameId: string
	version: number
	seats: [SeatCredentials, SeatCredentials]
}

/** An invite: the host keeps `host`; `invite` goes into the link. */
export interface CreatedInvite {
	gameId: string
	host: SeatCredentials
	invite: SeatCredentials
}

export type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface SubscribeOptions {
	onStatus?: ((status: StreamStatus) => void) | undefined
}

export interface Subscription {
	readonly status: StreamStatus
	close(): void
}

export interface WatchOptions extends SubscribeOptions {
	/** refetch failures (the stream keeps running) */
	onError?: ((err: unknown) => void) | undefined
	/** every stream event, after the view bookkeeping */
	onEvent?: ((event: GameStreamEvent) => void) | undefined
}

// ---------------------------------------------------------------------------
// Invite links — the token rides in the URL fragment, which browsers never
// send to a server (no access logs, no Referer).
// ---------------------------------------------------------------------------

const INVITE_KEY = 'join'

/** `<appUrl>#join=<gameId>.<token>` */
export function inviteLink(appUrl: string, seat: SeatCredentials): string {
	const base = appUrl.split('#')[0]!
	return `${base}#${INVITE_KEY}=${encodeURIComponent(seat.gameId)}.${encodeURIComponent(seat.token)}`
}

/** Parse an invite link (or its bare `<gameId>.<token>` part). */
export function parseInvite(link: string): SeatCredentials | null {
	const hash = link.includes('#') ? link.slice(link.indexOf('#') + 1) : link
	const params = new URLSearchParams(hash)
	const raw = params.get(INVITE_KEY) ?? hash
	const dot = raw.lastIndexOf('.')
	if (dot <= 0 || dot === raw.length - 1) return null
	try {
		const gameId = decodeURIComponent(raw.slice(0, dot))
		const token = decodeURIComponent(raw.slice(dot + 1))
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(gameId)) return null
		if (!/^[A-Za-z0-9_-]+$/.test(token)) return null
		return { gameId, token }
	} catch {
		return null
	}
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export class OnlineGameClient {
	readonly baseUrl: string
	private readonly fetchImpl: typeof fetch
	private readonly eventSource: EventSourceFactory
	private readonly initialDelayMs: number
	private readonly maxDelayMs: number

	constructor(opts: OnlineClientOptions) {
		this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
		this.fetchImpl =
			opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
		this.eventSource =
			opts.eventSource ??
			((url) => {
				const ctor = (
					globalThis as unknown as {
						EventSource?: new (url: string) => EventSourceLike
					}
				).EventSource
				if (ctor === undefined)
					throw new Error('OnlineGameClient: no EventSource in this runtime')
				return new ctor(url)
			})
		this.initialDelayMs = opts.reconnect?.initialDelayMs ?? 1000
		this.maxDelayMs = opts.reconnect?.maxDelayMs ?? 30_000
	}

	/** POST /games — a new game with both seats' credentials. */
	async createGame(req: CreateGameRequest): Promise<CreatedGame> {
		const res = await this.request<CreateGameResponse>('POST', '/games', {
			body: req,
		})
		return {
			gameId: res.gameId,
			version: res.version,
			seats: [
				{ gameId: res.gameId, token: res.tokens[0] },
				{ gameId: res.gameId, token: res.tokens[1] },
			],
		}
	}

	/** POST /games with `{ host }` — an invite; the guest picks a captain on
	 *  joining and opens the game. */
	async createInvite(req: CreateOpenGameRequest): Promise<CreatedInvite> {
		const res = await this.request<CreateGameResponse>('POST', '/games', {
			body: req,
		})
		return {
			gameId: res.gameId,
			host: { gameId: res.gameId, token: res.tokens[0] },
			invite: { gameId: res.gameId, token: res.tokens[1] },
		}
	}

	/** GET /games/:id/lobby — open invite or started game, for either seat. */
	getLobby(seat: SeatCredentials): Promise<GameLobby> {
		return this.request('GET', `${this.gamePath(seat)}/lobby`, {
			token: seat.token,
		})
	}

	/** POST /games/:id/join — answer an invite with your captain. Returns
	 *  your seat (a fresh token: the invite's is retired — store this one) and
	 *  your view of the started game (your move). */
	async joinGame(
		invite: SeatCredentials,
		req: JoinGameRequest,
	): Promise<{ seat: SeatCredentials; view: GameView }> {
		const res = await this.request<JoinGameResponse>(
			'POST',
			`${this.gamePath(invite)}/join`,
			{ token: invite.token, body: req },
		)
		return { seat: { gameId: invite.gameId, token: res.token }, view: res.view }
	}

	/** Take a seat from an invite link: validates it by fetching the view. */
	async joinByInvite(
		link: string,
	): Promise<{ seat: SeatCredentials; view: GameView }> {
		const seat = parseInvite(link)
		if (seat === null)
			throw new OnlineError(400, 'BAD_REQUEST', 'not an invite link')
		return { seat, view: await this.getView(seat) }
	}

	/** GET /games/:id — the seat's view. */
	getView(seat: SeatCredentials): Promise<GameView> {
		return this.request('GET', this.gamePath(seat), { token: seat.token })
	}

	/** POST /games/:id/intents — returns the new view. */
	submitIntent(
		seat: SeatCredentials,
		intent: Intent,
		version: number,
	): Promise<GameView> {
		return this.request('POST', `${this.gamePath(seat)}/intents`, {
			token: seat.token,
			body: { intent, version },
		})
	}

	/** POST /games/:id/undo — refused (UNDO_REFUSED) past a reveal. */
	undo(seat: SeatCredentials, version: number): Promise<GameView> {
		return this.request('POST', `${this.gamePath(seat)}/undo`, {
			token: seat.token,
			body: { version },
		})
	}

	/** PUT /games/:id/orders — this seat's standing order for a reaction card
	 *  (`ask` resets it). May immediately answer an interrupt you owe. */
	setStandingOrder(
		seat: SeatCredentials,
		cardDef: string,
		policy: StandingPolicy,
	): Promise<GameView> {
		return this.request('PUT', `${this.gamePath(seat)}/orders`, {
			token: seat.token,
			body: { cardDef, policy },
		})
	}

	/** GET /games/:id/recap — since your last own turn, or `since` a seq. */
	getRecap(
		seat: SeatCredentials,
		opts: { since?: number | undefined } = {},
	): Promise<Recap> {
		const q = opts.since === undefined ? '' : `?since=${opts.since}`
		return this.request('GET', `${this.gamePath(seat)}/recap${q}`, {
			token: seat.token,
		})
	}

	/** POST /games/summaries — inbox rows for the seats you hold. Unknown
	 *  games / revoked tokens come back in `errors`, not as a throw. */
	listGames(seats: SeatCredentials[]): Promise<SummariesResponse> {
		if (seats.length === 0)
			return Promise.resolve({ summaries: [], errors: [] })
		return this.request('POST', '/games/summaries', {
			body: {
				games: seats.map((s) => ({ gameId: s.gameId, token: s.token })),
			},
		})
	}

	/** The event-stream URL (the token rides in the query: EventSource cannot
	 *  send headers). */
	eventsUrl(seat: SeatCredentials): string {
		return `${this.baseUrl}${this.gamePath(seat)}/events?token=${encodeURIComponent(seat.token)}`
	}

	/**
	 * Server-Sent Events for one game: `hello` (on every (re)connect, with the
	 * current version — refetch if it is newer than yours), `version` (every
	 * change), `presence`. Reconnects with exponential backoff on any error
	 * (including a server restart); `close()` stops for good.
	 */
	subscribe(
		seat: SeatCredentials,
		onEvent: (event: GameStreamEvent) => void,
		opts: SubscribeOptions = {},
	): Subscription {
		let source: EventSourceLike | null = null
		let timer: ReturnType<typeof setTimeout> | null = null
		let delay = this.initialDelayMs
		let closed = false
		let status: StreamStatus = 'connecting'
		const setStatus = (next: StreamStatus): void => {
			if (status === next) return
			status = next
			opts.onStatus?.(next)
		}
		const retry = (): void => {
			setStatus('reconnecting')
			timer = setTimeout(() => {
				timer = null
				connect()
			}, delay)
			delay = Math.min(delay * 2, this.maxDelayMs)
		}
		const connect = (): void => {
			if (closed) return
			let es: EventSourceLike
			try {
				es = this.eventSource(this.eventsUrl(seat))
			} catch {
				retry()
				return
			}
			source = es
			es.onopen = () => {
				if (source !== es) return
				delay = this.initialDelayMs
				setStatus('open')
			}
			es.onerror = () => {
				if (closed || source !== es) return
				es.close()
				source = null
				retry()
			}
			for (const type of STREAM_EVENT_TYPES) {
				es.addEventListener(type, (ev) => {
					if (source !== es) return
					let data: GameStreamEvent
					try {
						data = JSON.parse(ev.data) as GameStreamEvent
					} catch {
						return
					}
					onEvent(data)
				})
			}
		}
		opts.onStatus?.(status)
		connect()
		return {
			get status() {
				return status
			},
			close: () => {
				if (closed) return
				closed = true
				if (timer !== null) clearTimeout(timer)
				timer = null
				source?.close()
				source = null
				setStatus('closed')
			},
		}
	}

	/**
	 * The usual UI loop: fetch the view, then refetch whenever the stream
	 * reports a newer version (a `version` event, or the `hello` after a
	 * reconnect) and hand each fresh view to `onView`.
	 */
	watch(
		seat: SeatCredentials,
		onView: (view: GameView) => void,
		opts: WatchOptions = {},
	): Subscription {
		let known = -1
		let inFlight = false
		let again = false
		let stopped = false
		const refresh = async (): Promise<void> => {
			if (inFlight) {
				again = true
				return
			}
			inFlight = true
			try {
				do {
					again = false
					const view = await this.getView(seat)
					if (stopped) return
					if (view.version >= known) {
						known = view.version
						onView(view)
					}
				} while (again && !stopped)
			} catch (err) {
				opts.onError?.(err)
			} finally {
				inFlight = false
			}
		}
		const sub = this.subscribe(
			seat,
			(event) => {
				if (
					(event.type === 'hello' || event.type === 'version') &&
					event.version > known
				)
					void refresh()
				opts.onEvent?.(event)
			},
			{ onStatus: opts.onStatus },
		)
		void refresh()
		return {
			get status() {
				return sub.status
			},
			close: () => {
				stopped = true
				sub.close()
			},
		}
	}

	// -------------------------------------------------------------------------

	private gamePath(seat: SeatCredentials): string {
		return `/games/${encodeURIComponent(seat.gameId)}`
	}

	private async request<T>(
		method: string,
		path: string,
		opts: { token?: string; body?: unknown },
	): Promise<T> {
		const headers: Record<string, string> = {}
		if (opts.body !== undefined) headers['content-type'] = 'application/json'
		if (opts.token !== undefined) headers.authorization = `Bearer ${opts.token}`
		let res: Response
		try {
			res = await this.fetchImpl(`${this.baseUrl}${path}`, {
				method,
				headers,
				...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
			})
		} catch (err) {
			throw new OnlineError(0, 'NETWORK', (err as Error).message)
		}
		const text = await res.text()
		let json: unknown = null
		try {
			json = text === '' ? null : (JSON.parse(text) as unknown)
		} catch {
			json = null
		}
		if (!res.ok) {
			const body = (json ?? {}) as {
				code?: ErrorCode
				error?: string
				version?: number
			}
			throw new OnlineError(
				res.status,
				body.code ?? 'INTERNAL',
				body.error ?? `HTTP ${res.status}`,
				body.version,
			)
		}
		return json as T
	}
}
