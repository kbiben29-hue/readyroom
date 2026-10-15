// Remote storage adapter (server/README.md): the game's existing `Storage`
// seam (persistence.ts) implemented over the backend's REST API. Drop it into
// SessionStore exactly where InMemoryStorage / IndexedDB go today —
//
//   const store = new SessionStore(createHttpStorage('http://localhost:8787'))
//
// The session layer never learns about HTTP; `listSessions`/`loadSession`/
// `saveSession` behave identically. This is also the multiplayer seam: every
// save is a PUT to the backend, so a second device/friend can fetch the same
// session id and replay it (the engine is byte-deterministic by design).

import type { Session, Storage } from './persistence'
import { SESSION_KEY_PREFIX, SessionStore, sessionKey } from './persistence'

export interface HttpStorageOptions {
	/** Test seam: swap in a mock fetch (node or jsdom). Defaults to global fetch. */
	fetchImpl?: typeof fetch
}

/** Backwards of sessionKey — pull the game id back out of a stored key. */
export function keyToSessionId(key: string): string | null {
	const prefix = `${SESSION_KEY_PREFIX}:`
	return key.startsWith(prefix) ? key.slice(prefix.length) : null
}

function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export function createHttpStorage(
	baseUrl: string,
	opts: HttpStorageOptions = {},
): Storage {
	const fetchImpl =
		opts.fetchImpl ??
		((...args: [RequestInfo | URL, RequestInit?]) => fetch(...args))

	async function request(path: string, init?: RequestInit): Promise<Response> {
		const res = await fetchImpl(joinUrl(baseUrl, path), {
			...init,
			headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
		})
		if (!res.ok) {
			throw new Error(`session backend ${path}: HTTP ${res.status}`)
		}
		return res
	}

	/** The server routes on `/sessions/:id`; skip keys that aren't ours. */
	function idFor(key: string): string | null {
		const id = keyToSessionId(key)
		return id === null || id === '' ? null : id
	}

	return {
		async get(key) {
			const id = idFor(key)
			if (id === null) return undefined
			// A missing session is `undefined` (the Storage contract — matches
			// InMemoryStorage), so 404 is data, not an error.
			const res = await fetchImpl(
				joinUrl(baseUrl, `/sessions/${encodeURIComponent(id)}`),
			)
			if (res.status === 404) return undefined
			if (!res.ok)
				throw new Error(`session backend /sessions/${id}: HTTP ${res.status}`)
			return (await res.json()) as unknown
		},
		async set(key, value) {
			// The backend stores the whole session, not the internal key — the
			// value's own id is the file name. Mirror what the session layer ships
			// (values always carry id), so a stray key never splits from its data.
			const v = value as { id?: unknown }
			const id = typeof v?.id === 'string' ? v.id : idFor(key)
			if (id === null || id === '')
				throw new Error(`createHttpStorage.set: no session id for key "${key}"`)
			await request(`/sessions/${encodeURIComponent(id)}`, {
				method: 'PUT',
				body: JSON.stringify(value),
			})
		},
		async del(key) {
			const id = idFor(key)
			if (id === null) return
			await request(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
		},
		async keys() {
			const res = await request(`/sessions`)
			const summaries = (await res.json()) as Array<{ id: string }>
			return summaries.map((s) => {
				if (typeof s.id !== 'string')
					throw new Error('createHttpStorage.keys: bad summary from backend')
				return sessionKey(s.id)
			})
		},
	}
}

/** Convenience wrapper mirroring the local SessionStore, pre-bound to a URL. */
export function createRemoteSessionStore(
	baseUrl: string,
	opts: HttpStorageOptions = {},
) {
	return new SessionStore(createHttpStorage(baseUrl, opts))
}

export { sessionKey }

/** Push one session to a backend and wait for it to acknowledge. The engine
 *  replay is byte-deterministic, so the stored JSON is the entire game —
 *  this single call is what "sync to server" means (server/README.md). */
export async function syncSessionTo(
	server: string,
	session: Session,
	opts: HttpStorageOptions = {},
): Promise<void> {
	const store = createRemoteSessionStore(server, opts)
	await store.save(session)
}
