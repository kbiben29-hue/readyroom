// End-to-end tests for the authoritative online games (server/games.ts):
// boots the real HTTP server on an ephemeral port and plays a scripted game
// through the API with both seats, using the real client (src/session/
// online.ts) over a recording fetch.
//
// The script: KOL (seat 0) vs SIS (seat 1), both BASIC, seed 17 — SIS
// starts. Each step the seat that must decide takes the first-legal driver's
// intent from its own view (nextAutoIntent). Landmarks:
//   step 1   SIS activates his Captain (a choice; nothing revealed)
//   step 3   SIS plays a card (revealed to KOL only)
//   step 6   the gained card goes on the deck; the Market refills (a reveal)
//   step 17  SIS's Clean-up choice hands the turn to KOL
//   step 20  KOL's Captain offers SIS "you may draw a card?" (interrupt)
//   step 23  KOL takes control of a Location: SIS's 1SIS23 reacts
//
// Every response a seat receives is checked on the way in: no real id of a
// card hidden from that seat, no def that only hidden cards carry, and no
// seed.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCatalog } from '../src/data/catalog'
import type { CardCatalog } from '../src/engine/setup'
import { setup } from '../src/engine/setup'
import type { GameState } from '../src/engine/state'
import { reduce, type Intent } from '../src/engine/intents'
import type { Seat } from '../src/engine/resolver/queries'
import { HIDDEN_DEF, hiddenCards } from '../src/engine/projection'
import { HIDDEN_IID, IID_TOKEN, isHiddenAlias } from '../src/engine/seatView'
import { nextAutoIntent } from '../src/bot/autoPlay'
import {
	OnlineError,
	OnlineGameClient,
	type EventSourceLike,
	type GameStreamEvent,
	type GameView,
	type SeatCredentials,
} from '../src/session/online'
import { FileSessionStorage } from './storage'
import { startServer } from './app'
import { GameService, type GameServiceOptions } from './games'
import { isOpenDoc, type GameDoc, type OpenGameDoc } from './gameStore'

const SEED = 17
const SIS23 = '1SIS23-25'
const T0 = Date.parse('2026-09-28T08:00:00.000Z')
const HOUR = 60 * 60 * 1000
const PLAYERS = [
	{ deck: 'KOL', boardSide: 'BASIC' },
	{ deck: 'SIS', boardSide: 'BASIC' },
] as const

let catalog: CardCatalog
let dataDir: string
let server: Server
let service: GameService
let client: OnlineGameClient
let base: string
const clock = { t: T0 }
/** token → the seat it holds (for the leak check) */
const seatsByToken = new Map<string, { gameId: string; seat: Seat }>()
const streams: NodeEventSource[] = []
let checkedBodies = 0

beforeAll(async () => {
	catalog = await loadCatalog()
})

async function boot(opts: Partial<GameServiceOptions> = {}): Promise<void> {
	dataDir = await mkdtemp(join(tmpdir(), 'captain-games-'))
	clock.t = T0
	service = await GameService.open({
		dir: join(dataDir, 'games'),
		catalog,
		now: () => clock.t,
		randomSeed: () => SEED,
		deadlineCheckMs: 0,
		heartbeatMs: 0,
		log: () => {},
		...opts,
	})
	server = startServer(
		new FileSessionStorage(join(dataDir, 'sessions')),
		0,
		'127.0.0.1',
		{ games: service },
	)
	await new Promise<void>((resolve) =>
		server.once('listening', () => resolve()),
	)
	const addr = server.address()
	if (addr === null || typeof addr === 'string') throw new Error('no port')
	base = `http://127.0.0.1:${addr.port}`
	client = new OnlineGameClient({
		baseUrl: base,
		fetchImpl: checkedFetch,
		eventSource: (url) => {
			const es = new NodeEventSource(url)
			streams.push(es)
			return es
		},
		reconnect: { initialDelayMs: 20, maxDelayMs: 50 },
	})
}

beforeEach(async () => {
	seatsByToken.clear()
	checkedBodies = 0
	leaks.length = 0
	await boot()
})

async function shutdown(): Promise<void> {
	for (const es of streams.splice(0)) es.close()
	service.close()
	server.closeAllConnections()
	await new Promise<void>((resolve, reject) =>
		server.close((err) => (err ? reject(err) : resolve())),
	)
	await rm(dataDir, { recursive: true, force: true })
}

/** Restart with different service options (inside a test). */
async function reboot(opts: Partial<GameServiceOptions>): Promise<void> {
	await shutdown()
	await boot(opts)
}

afterEach(async () => {
	await shutdown()
	expect(leaks).toEqual([])
})

// ---------------------------------------------------------------------------
// The leak check: every seat-authenticated response, checked as it arrives
// ---------------------------------------------------------------------------

function replayDoc(doc: GameDoc, upTo = doc.game.log.length): GameState[] {
	let s = setup(
		{
			mode: 'TWO_PLAYER',
			players: [...doc.game.setupPlayers],
			seed: doc.secret.seed,
			startingSeat: doc.game.startingSeat,
		},
		catalog,
	)
	const out = [s]
	for (const entry of doc.game.log.slice(0, upTo)) {
		s = reduce(s, entry.intent).state
		out.push(s)
	}
	return out
}

/** Problems (not throws — a throw inside fetch would surface as a client
 *  NETWORK error) collected per test and asserted empty in afterEach. */
const leaks: string[] = []

function findHidden(
	text: string,
	hidden: Set<string>,
	visibleDefs: Set<string>,
	defOf: (iid: string) => string,
): string[] {
	const out: string[] = []
	for (const token of text.match(IID_TOKEN) ?? [])
		if (hidden.has(token)) out.push(`hidden id ${token}`)
	for (const iid of hidden) {
		const def = defOf(iid)
		if (!visibleDefs.has(def) && text.includes(`"${def}"`))
			out.push(`hidden def ${def}`)
	}
	return out
}

/** `path` decides the yardstick: views, summaries and errors are checked
 *  against what the seat cannot see right now; recaps and stream events
 *  (which may name what it saw at the time) against the cards it has never
 *  been able to see in the whole game. */
async function leakCheck(
	path: string,
	token: string,
	text: string,
): Promise<void> {
	const holder = seatsByToken.get(token)
	if (holder === undefined) return
	checkedBodies++
	const found: string[] = []
	// the seed: a view's RNG is zeroed; no other field carries it
	for (const m of text.matchAll(/"seed":\s*(\d+)/g))
		if (m[1] !== '0') found.push(`seed ${m[1]}`)
	const stored = await service.store.get(holder.gameId)
	if (stored !== null && isOpenDoc(stored)) {
		// an open invite has no cards yet; only its secret part could leak
		for (const h of stored.secret.tokenHashes)
			if (text.includes(h)) found.push('token hash')
		for (const f of found) leaks.push(`${path} (seat ${holder.seat}): ${f}`)
		return
	}
	const { doc, state } = await service.inspect(holder.gameId)
	const seat = holder.seat
	const defOf = (iid: string): string => state.cards[iid]!.def
	if (path.includes('/recap') || path.includes('/events')) {
		const seen = new Set<string>()
		for (const s of replayDoc(doc)) {
			const hid = hiddenCards(s, seat) as Set<string>
			for (const iid of Object.keys(s.cards)) if (!hid.has(iid)) seen.add(iid)
		}
		const never = new Set(Object.keys(state.cards).filter((i) => !seen.has(i)))
		const seenDefs = new Set([...seen].map(defOf))
		found.push(...findHidden(text, never, seenDefs, defOf))
	} else {
		// The seat's own standing orders name its own deck list — leave them
		// out of the def check.
		const body = JSON.parse(text) as { orders?: unknown }
		delete body.orders
		const hidden = hiddenCards(state, seat) as Set<string>
		const visibleDefs = new Set(
			Object.values(state.cards)
				.filter((c) => !hidden.has(c.iid))
				.map((c) => c.def),
		)
		found.push(...findHidden(JSON.stringify(body), hidden, visibleDefs, defOf))
	}
	for (const f of found) leaks.push(`${path} (seat ${seat}): ${f}`)
}

const checkedFetch: typeof fetch = async (input, init) => {
	const res = await fetch(input, init)
	const text = await res.clone().text()
	const url = String(input)
	const headers = (init?.headers ?? {}) as Record<string, string>
	const auth = headers.authorization
	if (auth !== undefined)
		await leakCheck(url, auth.slice('Bearer '.length), text)
	if (res.ok && url.endsWith('/games/summaries')) {
		const games = (
			JSON.parse(String(init?.body)) as { games: SeatCredentials[] }
		).games
		const out = JSON.parse(text) as {
			summaries: { gameId: string; seat: Seat }[]
		}
		for (const s of out.summaries) {
			const creds = games.find(
				(g) =>
					g.gameId === s.gameId && seatsByToken.get(g.token)?.seat === s.seat,
			)
			if (creds !== undefined)
				await leakCheck('/summaries', creds.token, JSON.stringify(s))
		}
	}
	return res
}

// ---------------------------------------------------------------------------
// A minimal EventSource over fetch streaming (node has none)
// ---------------------------------------------------------------------------

class NodeEventSource implements EventSourceLike {
	readyState = 0
	onopen: ((ev: unknown) => void) | null = null
	onerror: ((ev: unknown) => void) | null = null
	private readonly listeners = new Map<
		string,
		((ev: { data: string }) => void)[]
	>()
	private readonly ctrl = new AbortController()

	constructor(url: string) {
		void this.run(url)
	}

	addEventListener(
		type: string,
		listener: (ev: { data: string }) => void,
	): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
	}

	close(): void {
		this.readyState = 2
		this.ctrl.abort()
	}

	private async run(url: string): Promise<void> {
		try {
			const res = await fetch(url, { signal: this.ctrl.signal })
			if (!res.ok || res.body === null) throw new Error(`HTTP ${res.status}`)
			this.readyState = 1
			this.onopen?.({})
			const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
			let buf = ''
			for (;;) {
				const { value, done } = await reader.read()
				if (done) break
				buf += value
				let end: number
				while ((end = buf.indexOf('\n\n')) >= 0) {
					const block = buf.slice(0, end)
					buf = buf.slice(end + 2)
					let type = 'message'
					let data = ''
					for (const line of block.split('\n')) {
						if (line.startsWith('event: ')) type = line.slice(7)
						else if (line.startsWith('data: ')) data += line.slice(6)
					}
					if (data === '') continue
					const token = new URL(url).searchParams.get('token') ?? ''
					await leakCheck('/events', token, data)
					for (const l of this.listeners.get(type) ?? []) l({ data })
				}
			}
			throw new Error('stream ended')
		} catch {
			if (this.readyState === 2) return
			this.readyState = 2
			this.onerror?.({})
		}
	}
}

// ---------------------------------------------------------------------------
// Scripted play
// ---------------------------------------------------------------------------

interface Game {
	gameId: string
	seats: [SeatCredentials, SeatCredentials]
}

async function newGame(settings?: { deadlineMs: number }): Promise<Game> {
	const created = await client.createGame({
		players: [{ ...PLAYERS[0] }, { ...PLAYERS[1] }],
		...(settings === undefined ? {} : { settings }),
	})
	created.seats.forEach((s, seat) =>
		seatsByToken.set(s.token, { gameId: s.gameId, seat: seat as Seat }),
	)
	return { gameId: created.gameId, seats: created.seats }
}

/** The view of whichever seat must decide now. */
async function decider(game: Game): Promise<GameView> {
	const v0 = await client.getView(game.seats[0])
	if (v0.toMove === 0) return v0
	return client.getView(game.seats[1])
}

function autoIntent(view: GameView): Intent {
	const intent = nextAutoIntent(
		view.state as unknown as GameState,
		view.legalIntents,
	)
	if (intent === undefined) throw new Error('no legal intent')
	return intent
}

/** One driver step: the deciding seat submits its first-legal intent. */
async function step(game: Game): Promise<GameView> {
	const view = await decider(game)
	return client.submitIntent(
		game.seats[view.seat],
		autoIntent(view),
		view.version,
	)
}

/** Play until the log holds START + `steps` driver intents. */
async function playTo(game: Game, steps: number): Promise<void> {
	while ((await service.inspect(game.gameId)).doc.game.log.length < steps + 1)
		await step(game)
}

async function logOf(game: Game): Promise<GameDoc['game']['log']> {
	return (await service.inspect(game.gameId)).doc.game.log
}

async function rejection(p: Promise<unknown>): Promise<OnlineError> {
	const err = await p.then(
		() => null,
		(e: unknown) => e,
	)
	expect(err).toBeInstanceOf(OnlineError)
	return err as OnlineError
}

function waitFor<T>(
	events: GameStreamEvent[],
	pred: (e: GameStreamEvent) => e is GameStreamEvent & T,
): Promise<GameStreamEvent & T> {
	return new Promise((resolve, reject) => {
		const started = Date.now()
		const poll = (): void => {
			const hit = events.find(pred)
			if (hit !== undefined) return resolve(hit)
			if (Date.now() - started > 5000) return reject(new Error('event timeout'))
			setTimeout(poll, 5)
		}
		poll()
	})
}

// ---------------------------------------------------------------------------

describe('creating a game and seat views', () => {
	it('opens on the starting seat’s turn; each seat sees only its own hand', async () => {
		const game = await newGame()
		const [v0, v1] = [
			await client.getView(game.seats[0]),
			await client.getView(game.seats[1]),
		]
		expect(v0.version).toBe(1)
		expect(v0.intentCount).toBe(1) // the server's START
		expect([v0.seat, v1.seat]).toEqual([0, 1])
		expect(v0.players.map((p) => p.deck)).toEqual(['KOL', 'SIS'])
		expect(v1.toMove).toBe(1) // seed 17: SIS starts
		expect(v1.yourMove).toBe(true)
		expect(v0.yourMove).toBe(false)
		expect(v1.legalIntents.length).toBeGreaterThan(0)
		expect(v0.legalIntents).toEqual([])
		expect(v1.canUndo).toBe(false) // START is the server's
		const hand1 = v1.state.zones['HAND:1']!
		expect(hand1.every((iid) => v1.state.cards[iid]!.def !== HIDDEN_DEF)).toBe(
			true,
		)
		const seen0 = v0.state.zones['HAND:1']!
		expect(seen0).toHaveLength(hand1.length)
		expect(seen0.every(isHiddenAlias)).toBe(true)
		expect(seen0.every((a) => v0.state.cards[a]!.def === HIDDEN_DEF)).toBe(true)
		expect(v0.state.rng).toEqual({ seed: 0, counter: 0 })
		expect(checkedBodies).toBeGreaterThanOrEqual(2)
	})

	it('stores the seed and token hashes apart and never serves them', async () => {
		const game = await newGame()
		const file = await readFile(
			join(dataDir, 'games', `${game.gameId}.json`),
			'utf8',
		)
		const doc = JSON.parse(file) as GameDoc
		expect(doc.secret.seed).toBe(SEED)
		expect(JSON.stringify(doc.game)).not.toContain('"seed"')
		for (const [seat, creds] of game.seats.entries()) {
			expect(file).not.toContain(creds.token)
			expect(doc.secret.tokenHashes[seat]).toMatch(/^[0-9a-f]{64}$/)
		}
	})

	it('never serves a distinctive seed in any response', async () => {
		const secret = 3141592653
		await reboot({ randomSeed: () => secret })
		const bodies: string[] = []
		const raw = new OnlineGameClient({
			baseUrl: base,
			fetchImpl: async (input, init) => {
				const res = await fetch(input, init)
				bodies.push(await res.clone().text())
				return res
			},
		})
		const created = await raw.createGame({
			players: [{ ...PLAYERS[0] }, { ...PLAYERS[1] }],
		})
		for (const seat of created.seats) {
			const view = await raw.getView(seat)
			await raw.getRecap(seat)
			await raw.getRecap(seat, { since: 0 })
			if (view.yourMove)
				await raw.submitIntent(seat, autoIntent(view), view.version)
		}
		await raw.listGames(created.seats)
		const hello = await fetch(raw.eventsUrl(created.seats[0]))
		const reader = hello.body!.pipeThrough(new TextDecoderStream()).getReader()
		let stream = ''
		while (!stream.includes('event: hello'))
			stream += (await reader.read()).value ?? ''
		await reader.cancel()
		bodies.push(stream)
		expect(bodies.length).toBeGreaterThan(6)
		for (const body of bodies) expect(body).not.toContain(String(secret))
		const onDisk = await readFile(
			join(dataDir, 'games', `${created.gameId}.json`),
			'utf8',
		)
		expect(onDisk).toContain(String(secret))
	})
})

describe('submitting intents', () => {
	it('rejects the wrong seat, a stale version, a bad token and illegal intents', async () => {
		const game = await newGame()
		const v1 = await client.getView(game.seats[1])
		const intent = autoIntent(v1)
		const wrongSeat = await rejection(
			client.submitIntent(game.seats[0], intent, v1.version),
		)
		expect(wrongSeat).toMatchObject({ status: 403, code: 'NOT_YOUR_DECISION' })
		const stale = await rejection(
			client.submitIntent(game.seats[1], intent, v1.version - 1),
		)
		expect(stale).toMatchObject({
			status: 409,
			code: 'STALE_VERSION',
			version: v1.version,
		})
		const bad = await rejection(
			client.getView({ gameId: game.gameId, token: 'not-a-seat' }),
		)
		expect(bad).toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
		const missing = await rejection(
			client.getView({ gameId: 'game-nope', token: game.seats[0].token }),
		)
		expect(missing).toMatchObject({ status: 404, code: 'NOT_FOUND' })
		const illegal = await rejection(
			client.submitIntent(
				game.seats[1],
				{ t: 'COMPLETE_MISSION', index: 2 },
				v1.version,
			),
		)
		expect(illegal).toMatchObject({ status: 422, code: 'ILLEGAL_INTENT' })
		// nothing of that changed the game
		expect((await client.getView(game.seats[1])).version).toBe(v1.version)
	})

	it('lets exactly one of two racing submissions through', async () => {
		const game = await newGame()
		const v1 = await client.getView(game.seats[1])
		const intent = autoIntent(v1)
		const results = await Promise.allSettled([
			client.submitIntent(game.seats[1], intent, v1.version),
			client.submitIntent(game.seats[1], intent, v1.version),
		])
		expect(results.map((r) => r.status).sort()).toEqual([
			'fulfilled',
			'rejected',
		])
		const failed = results.find(
			(r) => r.status === 'rejected',
		) as PromiseRejectedResult
		expect(failed.reason).toMatchObject({ code: 'STALE_VERSION' })
		expect(await logOf(game)).toHaveLength(2)
	})

	it('refuses a hidden card offered by alias without naming its real id', async () => {
		const game = await newGame()
		await playTo(game, 3) // SIS must choose a card to put
		const v1 = await client.getView(game.seats[1])
		const choice = v1.state.pendingChoice!
		expect(choice.k).toBe('CHOOSE_CARDS')
		const deckTop = v1.state.zones['DRAW:0']![0]!
		expect(isHiddenAlias(deckTop)).toBe(true)
		const err = await rejection(
			client.submitIntent(
				game.seats[1],
				{ t: 'RESOLVE_CHOICE', choiceId: choice.id, selection: [deckTop] },
				v1.version,
			),
		)
		expect(err.code).toBe('ILLEGAL_INTENT')
		expect(err.message).toContain(deckTop) // the seat's own alias, echoed back
		expect(err.message.match(IID_TOKEN) ?? []).toEqual([])
	})
})

describe('undo', () => {
	it('works before a reveal and is refused past it', async () => {
		const game = await newGame()
		const first = await step(game) // step 1: a choice, nothing revealed
		expect(first.seat).toBe(1)
		expect(first.canUndo).toBe(true)
		const choiceId = first.state.pendingChoice!.id
		const notMine = await rejection(client.undo(game.seats[0], first.version))
		expect(notMine).toMatchObject({ code: 'UNDO_REFUSED' })
		const stale = await rejection(client.undo(game.seats[1], first.version - 1))
		expect(stale).toMatchObject({ code: 'STALE_VERSION' })
		const undone = await client.undo(game.seats[1], first.version)
		expect(undone.version).toBe(first.version + 1)
		expect(undone.intentCount).toBe(1)
		expect(undone.state.pendingChoice).toBeNull()
		expect(undone.canUndo).toBe(false) // back at the START floor
		// replaying the same decision reproduces the same choice
		const again = await step(game)
		expect(again.state.pendingChoice!.id).toBe(choiceId)

		await playTo(game, 3) // step 3 reveals SIS's card to KOL only
		expect((await client.getView(game.seats[1])).canUndo).toBe(true)
		await playTo(game, 6) // step 6 refills the Market: a reveal to SIS
		const log = await logOf(game)
		expect(log.at(-1)!.floor).toBe(true)
		const v1 = await client.getView(game.seats[1])
		expect(v1.canUndo).toBe(false)
		const refused = await rejection(client.undo(game.seats[1], v1.version))
		expect(refused).toMatchObject({ status: 422, code: 'UNDO_REFUSED' })
		expect(await logOf(game)).toHaveLength(7)
	})
})

describe('interrupts', () => {
	it('an expired deadline applies the safe default and logs the timeout', async () => {
		const game = await newGame()
		await playTo(game, 20) // KOL's Captain: SIS "may draw a card?"
		const v0 = await client.getView(game.seats[0])
		expect(v0.toMove).toBe(1)
		expect(v0.state.activeSeat).toBe(0)
		expect(v0.pending).toMatchObject({
			seat: 1,
			kind: 'CONFIRM',
			sourceDef: '1KOL01-24',
			deadline: new Date(T0 + 12 * HOUR).toISOString(),
		})
		const v1 = await client.getView(game.seats[1])
		expect(v1.yourMove).toBe(true)
		expect(v1.state.pendingChoice?.k).toBe('CONFIRM')
		expect(v0.state.pendingChoice).toBeNull() // not KOL's to see
		const { summaries } = await client.listGames(game.seats)
		expect(summaries[1]!.pendingOnYou?.kind).toBe('CONFIRM')
		expect(summaries[0]!.pendingOnYou).toBeNull()

		clock.t = T0 + 12 * HOUR - 1000
		expect((await client.getView(game.seats[0])).pending).not.toBeNull()
		clock.t = T0 + 12 * HOUR + 1
		const after = await client.getView(game.seats[0]) // a read settles it
		expect(after.version).toBe(v0.version + 1)
		expect(after.pending).toBeNull()
		expect(after.yourMove).toBe(true)
		const last = (await logOf(game)).at(-1)!
		expect(last).toMatchObject({ seat: 1, by: 'timeout', floor: true })
		expect(last.intent).toMatchObject({ t: 'RESOLVE_CHOICE', selection: false })
		// the stale version SIS still holds is refused
		const late = await rejection(
			client.submitIntent(game.seats[1], autoIntent(v1), v1.version),
		)
		expect(late.code).toBe('STALE_VERSION')
		// …and his recap shows the timed-out answer as his
		const recap = await client.getRecap(game.seats[1])
		const mine = recap.entries.filter((e) => e.yours)
		expect(mine.at(-1)).toMatchObject({
			by: 'timeout',
			choice: { kind: 'CONFIRM' },
		})
	})

	it('the deadline timer settles an expired interrupt with no request at all', async () => {
		await reboot({ deadlineCheckMs: 10 })
		const game = await newGame({ deadlineMs: HOUR })
		await playTo(game, 20)
		const v0 = await client.getView(game.seats[0])
		expect(v0.pending?.deadline).toBe(new Date(clock.t + HOUR).toISOString())
		const events: GameStreamEvent[] = []
		const sub = client.subscribe(game.seats[0], (e) => events.push(e))
		await waitFor(
			events,
			(e): e is Extract<GameStreamEvent, { type: 'hello' }> =>
				e.type === 'hello',
		)
		clock.t += HOUR + 1
		const bump = await waitFor(
			events,
			(e): e is Extract<GameStreamEvent, { type: 'version' }> =>
				e.type === 'version',
		)
		expect(bump).toMatchObject({
			version: v0.version + 1,
			pending: null,
			toMove: 0,
		})
		expect((await logOf(game)).at(-1)!.by).toBe('timeout')
		sub.close()
	})

	it('a standing order auto-answers a reaction on the opponent’s turn', async () => {
		const game = await newGame()
		await playTo(game, 22)
		const set = await client.setStandingOrder(game.seats[1], SIS23, 'always')
		expect(set.orders).toEqual({ [SIS23]: 'always' })
		expect(set.version).toBe((await client.getView(game.seats[0])).version) // no bump
		const bad = await rejection(
			client.setStandingOrder(game.seats[1], '1KOL01-24', 'always'),
		)
		expect(bad.code).toBe('BAD_REQUEST') // not a reaction card
		const before = (await service.inspect(game.gameId)).state
		const v0 = await step(game) // step 23: KOL takes control → 1SIS23 reacts
		expect(v0.seat).toBe(0)
		expect(v0.pending).toBeNull()
		expect(v0.yourMove).toBe(true)
		const log = await logOf(game)
		const answer = log.at(-1)!
		expect(answer).toMatchObject({ seat: 1, by: 'order', floor: true })
		const selection = (answer.intent as { selection: { card: string }[] })
			.selection
		const after = (await service.inspect(game.gameId)).state
		expect(selection.map((r) => after.cards[r.card]!.def)).toEqual([SIS23])
		// 1SIS23: draw a card, gain 1 DIL
		expect(after.zones['HAND:1']!.length).toBe(
			before.zones['HAND:1']!.length + 1,
		)
		expect(after.players[1].resources.DIL).toBe(
			before.players[1].resources.DIL + 1,
		)
		// KOL sees the reaction happened, not the card SIS drew
		const drawn = after.zones['HAND:1']!.find(
			(i) => !before.zones['HAND:1']!.includes(i),
		)!
		expect(JSON.stringify(v0)).not.toContain(drawn)
		const theirHand = v0.state.zones['HAND:1']!
		expect(theirHand).toHaveLength(after.zones['HAND:1']!.length)

		// SIS's recap: KOL's turn, with his own answers marked
		const recap = await client.getRecap(game.seats[1])
		expect(recap.entries.every((e) => e.activeSeat === 0)).toBe(true)
		expect(recap.entries.map((e) => e.by)).toContain('order')
		const own = recap.entries.filter((e) => e.yours)
		expect(own.map((e) => e.by)).toEqual(['player', 'order'])
		const draw = own[1]!.events.find((e) => e.k === 'CARD_DRAWN')
		expect(draw).toMatchObject({ seat: 1, iid: drawn }) // his own draw: real
		const kolRecap = await client.getRecap(game.seats[0], {
			since: log.length - 1,
		})
		const hisDraw = kolRecap.entries[0]!.events.find(
			(e) => e.k === 'CARD_DRAWN',
		)
		expect(hisDraw).toMatchObject({ seat: 1, iid: HIDDEN_IID }) // to KOL: hidden
		expect(recap.after.turn).toBe(2)
	})

	it('setting an order answers the reaction window you already owe', async () => {
		const game = await newGame()
		await playTo(game, 23) // no order: the window waits for SIS
		const v0 = await client.getView(game.seats[0])
		expect(v0.pending).toMatchObject({ seat: 1, kind: 'OPTIONAL_TRIGGERS' })
		expect(v0.yourMove).toBe(false)
		const v1 = await client.setStandingOrder(game.seats[1], SIS23, 'never')
		expect(v1.version).toBe(v0.version + 1)
		expect(v1.pending).toBeNull()
		expect((await logOf(game)).at(-1)).toMatchObject({
			seat: 1,
			by: 'order',
			intent: { t: 'RESOLVE_CHOICE', selection: [] },
		})
	})
})

describe('realtime, summaries and recap', () => {
	it('streams version bumps and presence over SSE', async () => {
		const game = await newGame()
		const events0: GameStreamEvent[] = []
		const sub0 = client.subscribe(game.seats[0], (e) => events0.push(e))
		const hello = await waitFor(
			events0,
			(e): e is Extract<GameStreamEvent, { type: 'hello' }> =>
				e.type === 'hello',
		)
		expect(hello).toMatchObject({
			seat: 0,
			version: 1,
			presence: [true, false],
		})
		const { summaries } = await client.listGames([game.seats[1]])
		expect(summaries[0]!.presence).toEqual([true, false])

		await step(game) // SIS moves
		const bump = await waitFor(
			events0,
			(e): e is Extract<GameStreamEvent, { type: 'version' }> =>
				e.type === 'version',
		)
		expect(bump).toMatchObject({
			version: 2,
			toMove: 1,
			activeSeat: 1,
			pending: null,
		})

		const events1: GameStreamEvent[] = []
		const sub1 = client.subscribe(game.seats[1], (e) => events1.push(e))
		await waitFor(
			events0,
			(e): e is Extract<GameStreamEvent, { type: 'presence' }> =>
				e.type === 'presence' && e.presence[1],
		)
		expect((await client.getView(game.seats[0])).presence).toEqual([true, true])
		const mark = events0.length
		sub1.close()
		await waitFor(
			events0,
			(e): e is Extract<GameStreamEvent, { type: 'presence' }> =>
				e.type === 'presence' && !e.presence[1] && events0.indexOf(e) >= mark,
		)
		sub0.close()
	})

	it('a bad token cannot open a stream', async () => {
		const game = await newGame()
		const res = await fetch(`${base}/games/${game.gameId}/events?token=nope`)
		expect(res.status).toBe(401)
	})

	it('summarises the inbox and recaps the opponent’s turn', async () => {
		const game = await newGame()
		await playTo(game, 17) // SIS's first turn is over; KOL to move
		const { summaries, errors } = await client.listGames([
			...game.seats,
			{ gameId: game.gameId, token: 'forged' },
			{ gameId: 'game-missing', token: game.seats[0].token },
		])
		expect(summaries.map((s) => [s.seat, s.yourMove])).toEqual([
			[0, true],
			[1, false],
		])
		expect(errors.map((e) => [e.gameId, e.status])).toEqual([
			[game.gameId, 401],
			['game-missing', 404],
		])
		const s0 = summaries[0]!
		expect(s0).toMatchObject({
			status: 'ACTIVE',
			activeSeat: 0,
			turn: 2,
			phase: 'ACTION',
			pending: null,
			result: null,
		})
		expect(s0.players.map((p) => p.deck)).toEqual(['KOL', 'SIS'])
		expect(s0.players.every((p) => p.deckName.length > 0)).toBe(true)
		expect(s0.stardate.def).not.toBeNull()
		expect(s0.stardate.remaining).toBeGreaterThan(0)
		expect(s0.score.every((n) => Number.isInteger(n))).toBe(true)
		expect(s0.lastSeen[1]).not.toBeNull()

		// KOL never had a turn: his recap is everything so far — SIS's turn
		const recap = await client.getRecap(game.seats[0])
		expect(recap.sinceSeq).toBe(0)
		expect(recap.toSeq).toBe(18)
		expect(recap.entries).toHaveLength(18)
		expect(recap.entries[0]).toMatchObject({
			by: 'server',
			intent: { t: 'START' },
		})
		expect(recap.entries.every((e) => !e.yours)).toBe(true)
		const plays = recap.entries.filter((e) => e.intent.t === 'PLAY_CARD')
		expect(plays.map((e) => e.card?.def)).toContain(SIS23) // played cards are public
		const draws = recap.entries
			.flatMap((e) => e.events)
			.filter((e) => e.k === 'CARD_DRAWN')
		expect(draws.length).toBeGreaterThan(0)
		expect(draws.every((e) => 'iid' in e && e.iid === HIDDEN_IID)).toBe(true)
		expect(recap.before.turn).toBeLessThan(recap.after.turn)
		const now = (await service.inspect(game.gameId)).state
		expect(recap.after.glory).toEqual([
			now.players[0].resources.GLO,
			now.players[1].resources.GLO,
		])
		// SIS has had no opponent turn since his own: nothing to recap
		expect((await client.getRecap(game.seats[1])).entries).toEqual([])
		// an explicit window
		const tail = await client.getRecap(game.seats[1], { since: 16 })
		expect(tail.entries.map((e) => e.seq)).toEqual([17, 18])
	})

	it('keeps the /sessions routes working next to /games', async () => {
		const put = await fetch(`${base}/sessions/game-abc`, {
			method: 'PUT',
			body: JSON.stringify({ version: 1, id: 'game-abc', log: [] }),
		})
		expect(put.status).toBe(200)
		const game = await newGame()
		const sessions = (await (await fetch(`${base}/sessions`)).json()) as {
			id: string
		}[]
		expect(sessions.map((s) => s.id)).toEqual(['game-abc']) // games live apart
		const leak = await fetch(`${base}/sessions/${game.gameId}`)
		expect(leak.status).toBe(404)
	})
})

describe('invites', () => {
	const HOST_CREW = { deck: 'KOL', boardSide: 'BASIC' } as const
	const GUEST_CREW = {
		deck: 'SIS',
		boardSide: 'ADVANCED',
		name: 'Ben',
	} as const

	async function newInvite() {
		const inv = await client.createInvite({
			host: { ...HOST_CREW, name: 'Rob' },
			settings: { deadlineMs: 4 * HOUR },
		})
		seatsByToken.set(inv.host.token, { gameId: inv.gameId, seat: 0 })
		seatsByToken.set(inv.invite.token, { gameId: inv.gameId, seat: 1 })
		return inv
	}

	it('waits for the guest, who picks a captain and opens the game', async () => {
		// seed 2 alone would start seat 0 — the invite overrides the draw
		await reboot({ randomSeed: () => 2 })
		expect(
			setup(
				{ mode: 'TWO_PLAYER', players: [HOST_CREW, GUEST_CREW], seed: 2 },
				catalog,
			).startingSeat,
		).toBe(0)

		const inv = await newInvite()
		const file = join(dataDir, 'games', `${inv.gameId}.json`)
		const open = JSON.parse(await readFile(file, 'utf8')) as OpenGameDoc
		expect(open.open.status).toBe('OPEN')
		expect(JSON.stringify(open)).not.toContain('"seed"')

		const lobby = await client.getLobby(inv.invite)
		expect(lobby).toMatchObject({
			seat: 1,
			status: 'OPEN',
			settings: { deadlineMs: 4 * HOUR },
		})
		expect(lobby.players[0]).toMatchObject({ deck: 'KOL', name: 'Rob' })
		expect(lobby.players[1]).toBeNull()
		expect((await client.getLobby(inv.host)).seat).toBe(0)

		// nothing to play yet
		expect((await rejection(client.getView(inv.host))).code).toBe('NOT_STARTED')
		// the host can't answer their own hail; the guest can't take their crew
		expect(
			(await rejection(client.joinGame(inv.host, GUEST_CREW))).status,
		).toBe(403)
		expect((await rejection(client.joinGame(inv.invite, HOST_CREW))).code).toBe(
			'BAD_REQUEST',
		)
		expect(
			(await rejection(client.getLobby({ ...inv.invite, token: 'forged' })))
				.status,
		).toBe(401)

		// the host waits on the stream
		const events0: GameStreamEvent[] = []
		const sub0 = client.subscribe(inv.host, (e) => events0.push(e))
		await waitFor(
			events0,
			(e): e is Extract<GameStreamEvent, { type: 'hello' }> =>
				e.type === 'hello' && e.version === 0,
		)

		const joined = await client.joinGame(inv.invite, GUEST_CREW)
		const guest = joined.seat
		seatsByToken.set(guest.token, { gameId: inv.gameId, seat: 1 })
		expect(guest.token).not.toBe(inv.invite.token)
		const view = joined.view
		expect(view).toMatchObject({
			seat: 1,
			version: 1,
			toMove: 1,
			yourMove: true,
			status: 'ACTIVE',
			settings: { deadlineMs: 4 * HOUR },
		})
		expect(view.players.map((p) => [p.deck, p.boardSide, p.name])).toEqual([
			['KOL', 'BASIC', 'Rob'],
			['SIS', 'ADVANCED', 'Ben'],
		])
		expect(view.legalIntents.length).toBeGreaterThan(0)
		await waitFor(
			events0,
			(e): e is Extract<GameStreamEvent, { type: 'version' }> =>
				e.type === 'version' && e.version === 1 && e.toMove === 1,
		)
		sub0.close()

		const hostView = await client.getView(inv.host)
		expect(hostView).toMatchObject({ seat: 0, yourMove: false, toMove: 1 })
		expect((await client.getLobby(guest)).status).toBe('ACTIVE')
		// the invite link is spent: the host saw it, so it no longer holds a seat
		expect((await rejection(client.getLobby(inv.invite))).status).toBe(401)
		expect((await rejection(client.getView(inv.invite))).status).toBe(401)
		expect((await rejection(client.joinGame(guest, GUEST_CREW))).code).toBe(
			'ALREADY_STARTED',
		)

		// the agreed first player survives a cold replay
		const game: Game = { gameId: inv.gameId, seats: [inv.host, guest] }
		await playTo(game, 5)
		const { doc, state } = await service.inspect(inv.gameId)
		expect(doc.game.startingSeat).toBe(1)
		const cold = new GameService({
			dir: join(dataDir, 'games'),
			catalog,
			deadlineCheckMs: 0,
			heartbeatMs: 0,
		})
		expect((await cold.inspect(inv.gameId)).state).toEqual(state)
		expect(replayDoc(doc).at(-1)).toEqual(state)
	})

	it('shows the host an open row in the inbox until the guest joins', async () => {
		const inv = await newInvite()
		const before = await client.listGames([inv.host])
		expect(before.summaries).toEqual([])
		expect(before.open).toHaveLength(1)
		expect(before.open![0]).toMatchObject({ gameId: inv.gameId, seat: 0 })

		await client.joinGame(inv.invite, GUEST_CREW)
		const after = await client.listGames([inv.host])
		expect(after.open).toEqual([])
		expect(after.summaries[0]).toMatchObject({
			gameId: inv.gameId,
			seat: 0,
			yourMove: false,
			turn: 1,
		})
	})
})
