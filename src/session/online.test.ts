// OnlineGameClient against a mocked fetch and a fake EventSource: request
// shapes (paths, bearer tokens, bodies), error mapping, invite links, and the
// stream's reconnect / watch loop. The real-server contract is covered by
// server/games.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	OnlineError,
	OnlineGameClient,
	inviteLink,
	isStaleVersion,
	parseInvite,
	type EventSourceLike,
	type GameStreamEvent,
	type GameView,
	type StreamStatus,
} from './online'

interface Call {
	url: string
	method: string
	headers: Record<string, string>
	body: unknown
}

function mockFetch(
	respond: (call: Call) => { status?: number; body?: unknown },
): { fetchImpl: typeof fetch; calls: Call[] } {
	const calls: Call[] = []
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const call: Call = {
			url: String(input),
			method: init?.method ?? 'GET',
			headers: (init?.headers ?? {}) as Record<string, string>,
			body:
				init?.body === undefined ? undefined : JSON.parse(String(init.body)),
		}
		calls.push(call)
		const out = respond(call)
		return new Response(
			out.body === undefined ? '' : JSON.stringify(out.body),
			{
				status: out.status ?? 200,
			},
		)
	}) as typeof fetch
	return { fetchImpl, calls }
}

class FakeEventSource implements EventSourceLike {
	static all: FakeEventSource[] = []
	readyState = 0
	onopen: ((ev: unknown) => void) | null = null
	onerror: ((ev: unknown) => void) | null = null
	closed = false
	private listeners = new Map<string, ((ev: { data: string }) => void)[]>()
	constructor(readonly url: string) {
		FakeEventSource.all.push(this)
	}
	addEventListener(type: string, listener: (ev: { data: string }) => void) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
	}
	close() {
		this.closed = true
		this.readyState = 2
	}
	open() {
		this.readyState = 1
		this.onopen?.({})
	}
	fail() {
		this.onerror?.({})
	}
	emit(event: GameStreamEvent) {
		for (const l of this.listeners.get(event.type) ?? [])
			l({ data: JSON.stringify(event) })
	}
}

const seat = { gameId: 'game-1234', token: 'tok_EN-abc' }
const BASE = 'http://bridge.test:8787/'

const fakeView = (version: number): GameView =>
	({ gameId: seat.gameId, seat: 1, version }) as unknown as GameView

afterEach(() => {
	FakeEventSource.all = []
	vi.useRealTimers()
})

describe('requests', () => {
	it('creates a game and hands back both seats', async () => {
		const { fetchImpl, calls } = mockFetch(() => ({
			status: 201,
			body: { gameId: 'game-9', tokens: ['t0', 't1'], version: 1 },
		}))
		const client = new OnlineGameClient({ baseUrl: BASE, fetchImpl })
		const players = [
			{ deck: 'PIC', boardSide: 'BASIC' },
			{ deck: 'SHR', boardSide: 'ADVANCED' },
		] as const
		const game = await client.createGame({ players: [...players] })
		expect(calls[0]).toMatchObject({
			url: 'http://bridge.test:8787/games',
			method: 'POST',
			body: { players },
		})
		expect(calls[0]!.headers.authorization).toBeUndefined()
		expect(game).toEqual({
			gameId: 'game-9',
			version: 1,
			seats: [
				{ gameId: 'game-9', token: 't0' },
				{ gameId: 'game-9', token: 't1' },
			],
		})
	})

	it('sends the seat token as a bearer header on every game call', async () => {
		const { fetchImpl, calls } = mockFetch((call) =>
			call.url.includes('/recap')
				? { body: { entries: [] } }
				: call.url.endsWith('/summaries')
					? { body: { summaries: [], errors: [] } }
					: { body: fakeView(3) },
		)
		const client = new OnlineGameClient({ baseUrl: BASE, fetchImpl })
		await client.getView(seat)
		await client.submitIntent(seat, { t: 'PASS' }, 3)
		await client.undo(seat, 4)
		await client.setStandingOrder(seat, '1SIS23-25', 'always')
		await client.getRecap(seat, { since: 7 })
		await client.getRecap(seat)
		await client.listGames([seat])
		expect(
			calls.map((c) => `${c.method} ${c.url.replace(BASE.slice(0, -1), '')}`),
		).toEqual([
			'GET /games/game-1234',
			'POST /games/game-1234/intents',
			'POST /games/game-1234/undo',
			'PUT /games/game-1234/orders',
			'GET /games/game-1234/recap?since=7',
			'GET /games/game-1234/recap',
			'POST /games/summaries',
		])
		for (const c of calls.slice(0, 6))
			expect(c.headers.authorization).toBe('Bearer tok_EN-abc')
		expect(calls[1]!.body).toEqual({ intent: { t: 'PASS' }, version: 3 })
		expect(calls[2]!.body).toEqual({ version: 4 })
		expect(calls[3]!.body).toEqual({ cardDef: '1SIS23-25', policy: 'always' })
		// summaries carry the tokens in the body, never in the URL
		expect(calls[6]!.body).toEqual({ games: [seat] })
		expect(calls[6]!.headers.authorization).toBeUndefined()
	})

	it('maps error bodies to OnlineError (stale version keeps the current one)', async () => {
		const { fetchImpl } = mockFetch(() => ({
			status: 409,
			body: { ok: false, code: 'STALE_VERSION', error: 'stale', version: 12 },
		}))
		const client = new OnlineGameClient({ baseUrl: BASE, fetchImpl })
		const err = await client
			.submitIntent(seat, { t: 'PASS' }, 3)
			.catch((e: unknown) => e)
		expect(err).toBeInstanceOf(OnlineError)
		expect(isStaleVersion(err)).toBe(true)
		expect(err).toMatchObject({
			status: 409,
			code: 'STALE_VERSION',
			version: 12,
		})
	})

	it('reports network failures as NETWORK errors', async () => {
		const fetchImpl = (async () => {
			throw new TypeError('connection refused')
		}) as typeof fetch
		const client = new OnlineGameClient({ baseUrl: BASE, fetchImpl })
		await expect(client.getView(seat)).rejects.toMatchObject({
			code: 'NETWORK',
			status: 0,
		})
	})

	it('lists nothing without a request when no seats are held', async () => {
		const { fetchImpl, calls } = mockFetch(() => ({ body: {} }))
		const client = new OnlineGameClient({ baseUrl: BASE, fetchImpl })
		expect(await client.listGames([])).toEqual({ summaries: [], errors: [] })
		expect(calls).toHaveLength(0)
	})
})

describe('invite links', () => {
	it('round-trips through the URL fragment', () => {
		const link = inviteLink('https://app.test/play?x=1#old', seat)
		expect(link).toBe('https://app.test/play?x=1#join=game-1234.tok_EN-abc')
		expect(parseInvite(link)).toEqual(seat)
		expect(parseInvite('game-1234.tok_EN-abc')).toEqual(seat)
	})

	it('rejects junk', () => {
		expect(parseInvite('https://app.test/play')).toBeNull()
		expect(parseInvite('#join=../../etc.tok')).toBeNull()
		expect(parseInvite('#join=game-1.')).toBeNull()
	})

	it('joins by fetching the invited seat’s view', async () => {
		const { fetchImpl, calls } = mockFetch(() => ({ body: fakeView(2) }))
		const client = new OnlineGameClient({ baseUrl: BASE, fetchImpl })
		const joined = await client.joinByInvite(
			inviteLink('https://app.test/', seat),
		)
		expect(joined.seat).toEqual(seat)
		expect(joined.view.version).toBe(2)
		expect(calls[0]!.headers.authorization).toBe(`Bearer ${seat.token}`)
		await expect(client.joinByInvite('nope')).rejects.toBeInstanceOf(
			OnlineError,
		)
	})
})

describe('subscribe', () => {
	const client = (fetchImpl?: typeof fetch) =>
		new OnlineGameClient({
			baseUrl: BASE,
			...(fetchImpl === undefined ? {} : { fetchImpl }),
			eventSource: (url) => new FakeEventSource(url),
			reconnect: { initialDelayMs: 100, maxDelayMs: 400 },
		})

	it('opens the stream with the token in the query and delivers events', () => {
		const events: GameStreamEvent[] = []
		const statuses: StreamStatus[] = []
		const sub = client().subscribe(seat, (e) => events.push(e), {
			onStatus: (s) => statuses.push(s),
		})
		const es = FakeEventSource.all[0]!
		expect(es.url).toBe(
			'http://bridge.test:8787/games/game-1234/events?token=tok_EN-abc',
		)
		es.open()
		const bump: GameStreamEvent = {
			type: 'version',
			gameId: seat.gameId,
			version: 5,
			toMove: 0,
			activeSeat: 0,
			pending: null,
			status: 'ACTIVE',
			lastActivity: '2026-09-28T08:00:00.000Z',
		}
		es.emit(bump)
		es.emit({ type: 'presence', gameId: seat.gameId, presence: [true, true] })
		expect(events).toEqual([
			bump,
			{ type: 'presence', gameId: seat.gameId, presence: [true, true] },
		])
		sub.close()
		expect(es.closed).toBe(true)
		expect(statuses).toEqual(['connecting', 'open', 'closed'])
	})

	it('reconnects with exponential backoff and resets it once open', () => {
		vi.useFakeTimers()
		const statuses: StreamStatus[] = []
		const sub = client().subscribe(seat, () => {}, {
			onStatus: (s) => statuses.push(s),
		})
		FakeEventSource.all[0]!.fail()
		expect(FakeEventSource.all[0]!.closed).toBe(true)
		expect(sub.status).toBe('reconnecting')
		vi.advanceTimersByTime(99)
		expect(FakeEventSource.all).toHaveLength(1)
		vi.advanceTimersByTime(1)
		expect(FakeEventSource.all).toHaveLength(2)
		FakeEventSource.all[1]!.fail()
		vi.advanceTimersByTime(199)
		expect(FakeEventSource.all).toHaveLength(2) // second delay doubled
		vi.advanceTimersByTime(1)
		expect(FakeEventSource.all).toHaveLength(3)
		FakeEventSource.all[2]!.open()
		expect(sub.status).toBe('open')
		FakeEventSource.all[2]!.fail()
		vi.advanceTimersByTime(100) // back to the initial delay
		expect(FakeEventSource.all).toHaveLength(4)
		sub.close()
		FakeEventSource.all[3]!.fail() // ignored after close
		vi.advanceTimersByTime(1000)
		expect(FakeEventSource.all).toHaveLength(4)
		expect(statuses.at(-1)).toBe('closed')
	})

	it('ignores events from a stream it already replaced', () => {
		vi.useFakeTimers()
		const events: GameStreamEvent[] = []
		const sub = client().subscribe(seat, (e) => events.push(e))
		const first = FakeEventSource.all[0]!
		first.fail()
		first.emit({
			type: 'presence',
			gameId: seat.gameId,
			presence: [false, true],
		})
		expect(events).toEqual([])
		sub.close()
	})

	it('watch refetches the view on a newer version or hello', async () => {
		let version = 1
		const { fetchImpl, calls } = mockFetch(() => ({ body: fakeView(version) }))
		const views: number[] = []
		const sub = client(fetchImpl).watch(seat, (v) => views.push(v.version))
		await vi.waitFor(() => expect(views).toEqual([1]))
		const es = FakeEventSource.all[0]!
		es.open()
		es.emit({
			type: 'hello',
			gameId: seat.gameId,
			seat: 1,
			version: 1,
			presence: [false, true],
		})
		expect(calls).toHaveLength(1) // not newer: no refetch
		version = 2
		es.emit({
			type: 'version',
			gameId: seat.gameId,
			version: 2,
			toMove: 1,
			activeSeat: 1,
			pending: null,
			status: 'ACTIVE',
			lastActivity: '2026-09-28T08:00:00.000Z',
		})
		await vi.waitFor(() => expect(views).toEqual([1, 2]))
		sub.close()
		expect(es.closed).toBe(true)
	})
})
