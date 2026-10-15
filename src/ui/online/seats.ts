// The phone's online identity (docs/ui-mobile.md §7): there are no accounts —
// a seat is a capability `{ gameId, token }` handed out when a game is created
// or read from an invite link. This keeps the seats this device holds, and the
// server it talks to, in localStorage (per device, like the shell override).
// Storage can be missing or throw (private windows, blocked site data), so
// every access is guarded and the app still works for the current session.

import type { SeatCredentials } from '../../session/online'
import { OnlineGameClient } from '../../session/online'

export interface StoredSeat extends SeatCredentials {
	/** ISO time this device took the seat */
	addedAt: string
	/** the host's own copy of the invite link, to share it again while no
	 *  one has answered (the server retires it once someone does) */
	invite?: string | undefined
}

const SEATS_KEY = 'ready-room:online-seats:v1'
const SERVER_KEY = 'ready-room:server-url'

/** In-memory fallback when localStorage is unavailable. */
let memorySeats: StoredSeat[] = []

function readStorage(key: string): string | null {
	try {
		return globalThis.localStorage?.getItem(key) ?? null
	} catch {
		return null
	}
}

function writeStorage(key: string, value: string | null): void {
	try {
		if (value === null) globalThis.localStorage?.removeItem(key)
		else globalThis.localStorage?.setItem(key, value)
	} catch {
		// storage blocked: the in-memory copy still serves this session
	}
}

function isStoredSeat(v: unknown): v is StoredSeat {
	if (v === null || typeof v !== 'object') return false
	const o = v as Record<string, unknown>
	return (
		typeof o['gameId'] === 'string' &&
		typeof o['token'] === 'string' &&
		typeof o['addedAt'] === 'string' &&
		(o['invite'] === undefined || typeof o['invite'] === 'string')
	)
}

/** Every seat this device holds, newest first. */
export function loadSeats(): StoredSeat[] {
	const raw = readStorage(SEATS_KEY)
	if (raw === null) return [...memorySeats]
	try {
		const parsed: unknown = JSON.parse(raw)
		if (!Array.isArray(parsed)) return [...memorySeats]
		const seats = parsed.filter(isStoredSeat)
		memorySeats = seats
		return [...seats]
	} catch {
		return [...memorySeats]
	}
}

function persist(seats: StoredSeat[]): void {
	memorySeats = seats
	writeStorage(SEATS_KEY, JSON.stringify(seats))
}

/** Keep a seat (idempotent: the same token is stored once, and keeps the
 *  invite link it was stored with). */
export function addSeat(
	seat: SeatCredentials & { invite?: string | undefined },
	now = new Date(),
): StoredSeat {
	const all = loadSeats()
	const invite = seat.invite ?? all.find((s) => s.token === seat.token)?.invite
	const seats = all.filter((s) => s.token !== seat.token)
	const stored: StoredSeat = {
		gameId: seat.gameId,
		token: seat.token,
		addedAt: now.toISOString(),
		...(invite === undefined ? {} : { invite }),
	}
	persist([stored, ...seats])
	return stored
}

/** Forget a seat on this device (the game itself goes on). */
export function removeSeat(token: string): void {
	persist(loadSeats().filter((s) => s.token !== token))
}

/** The game server: an explicit setting, else — in a production build, which
 *  the game server itself serves (docs/deploy.md) — the app's own origin, and
 *  in development port 8787 on the host that served the app (`npm run server`
 *  next to `npm run dev`, also from a phone on the same network). */
export function serverUrl(): string {
	const set = readStorage(SERVER_KEY)
	if (set !== null && set.trim() !== '') return set.trim().replace(/\/+$/, '')
	const loc = globalThis.location
	if (loc === undefined) return 'http://127.0.0.1:8787'
	if (import.meta.env.PROD) return loc.origin
	return `${loc.protocol}//${loc.hostname}:8787`
}

export function setServerUrl(url: string | null): void {
	writeStorage(
		SERVER_KEY,
		url === null || url.trim() === '' ? null : url.trim(),
	)
}

/** The page an invite link opens (this app, without any fragment). */
export function appUrl(): string {
	const loc = globalThis.location
	if (loc === undefined) return ''
	return `${loc.origin}${loc.pathname}`
}

let client: OnlineGameClient | null = null
let clientUrl = ''

/** One client per server URL. */
export function onlineClient(): OnlineGameClient {
	const url = serverUrl()
	if (client === null || clientUrl !== url) {
		client = new OnlineGameClient({ baseUrl: url })
		clientUrl = url
	}
	return client
}
