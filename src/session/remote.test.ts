// Remote storage adapter (remote.ts) against a mocked fetch: it must behave
// byte-identically to InMemoryStorage from the session layer's point of view —
// same key mapping, same upsert/read/delete/list semantics, same URL shape.

import { describe, expect, it } from 'vitest'
import { createHttpStorage, syncSessionTo } from './remote'
import { sessionKey, SESSION_KEY_PREFIX } from './persistence'

interface Call {
	url: string
	init: RequestInit | undefined
}

/** Minimal fetch mock: routes to a Map like the real backend does. */
function mockBackend() {
	const db = new Map<string, unknown>()
	const calls: Call[] = []
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input)
		calls.push({ url, init })
		const method = init?.method ?? 'GET'
		const path = url.replace(/^https?:\/\/[^/]+/, '')
		if (method === 'PUT') {
			const body = JSON.parse(String(init?.body))
			if (url.includes('/sessions/')) {
				const id = url.split('/').pop()!
				db.set(id, body)
				return new Response(JSON.stringify({ ok: true, id }), { status: 200 })
			}
		}
		if (method === 'DELETE') {
			const id = url.split('/').pop()!
			const had = db.delete(id)
			return new Response(JSON.stringify({ ok: true, id, removed: had }), {
				status: 200,
			})
		}
		if (path === '/sessions') {
			return new Response(
				JSON.stringify(
					[...db.entries()].map(([id, v]) => ({
						id,
						meta: (v as { meta: unknown }).meta,
					})),
				),
				{ status: 200 },
			)
		}
		if (path.startsWith('/sessions/')) {
			const id = url.split('/').pop()!
			if (id === 'boom')
				return new Response(JSON.stringify({ ok: false, error: 'boom' }), {
					status: 500,
				})
			const v = db.get(id)
			if (v === undefined)
				return new Response(JSON.stringify({ ok: false, error: '404' }), {
					status: 404,
				})
			return new Response(JSON.stringify(v), { status: 200 })
		}
		throw new Error(`unmocked route ${method} ${path}`)
	}) as typeof fetch
	return { db, calls, fetchImpl }
}

const session = (id: string): Record<string, unknown> => ({
	version: 2,
	id,
	setup: {},
	log: [],
	meta: { updatedAt: '2026-09-22T08:00:00.000Z' },
})

describe('createHttpStorage', () => {
	it('set → get round-trips through the same key mapping as local storage', async () => {
		const { db, fetchImpl } = mockBackend()
		const storage = createHttpStorage('http://localhost:8787', { fetchImpl })
		const id = 'game-uuid-1'
		await storage.set(sessionKey(id), session(id))
		expect(db.get(id)).toEqual(session(id))
		expect(await storage.get(sessionKey(id))).toEqual(session(id))
	})

	it('keys() returns our prefixed keys from the backend summary list', async () => {
		const { db, fetchImpl } = mockBackend()
		const storage = createHttpStorage('http://localhost:8787', { fetchImpl })
		db.set('game-a', session('game-a'))
		db.set('game-b', session('game-b'))
		const keys = await storage.keys()
		expect(keys.sort()).toEqual([sessionKey('game-a'), sessionKey('game-b')])
		expect(keys[0]!.startsWith(SESSION_KEY_PREFIX)).toBe(true)
	})

	it('get() on an unknown key returns undefined', async () => {
		const { fetchImpl } = mockBackend()
		const storage = createHttpStorage('http://localhost:8787', { fetchImpl })
		expect(await storage.get(sessionKey('missing'))).toBeUndefined()
	})

	it('del() removes the backend session', async () => {
		const { db, fetchImpl } = mockBackend()
		const storage = createHttpStorage('http://localhost:8787', { fetchImpl })
		const id = 'game-uuid-1'
		await storage.set(sessionKey(id), session(id))
		await storage.del(sessionKey(id))
		expect(db.has(id)).toBe(false)
		expect(await storage.get(sessionKey(id))).toBeUndefined()
	})

	it('set() falls back to values that already carry an id (no key parsing needed)', async () => {
		const { db, fetchImpl } = mockBackend()
		const storage = createHttpStorage('http://localhost:8787', { fetchImpl })
		await storage.set('some-other:key', { id: 'stray', version: 1 })
		expect((db.get('stray') as { id?: string } | undefined)?.id).toBe('stray')
	})

	it('set() refuses a value with no derivable session id and makes no call', async () => {
		const { fetchImpl, calls } = mockBackend()
		const storage = createHttpStorage('http://localhost:8787', { fetchImpl })
		await expect(storage.set('some-other:key', { foo: 1 })).rejects.toThrow()
		expect(calls.length).toBe(0)
	})

	it('surfaces backend HTTP errors (non-404) as rejections', async () => {
		const { fetchImpl } = mockBackend()
		void fetchImpl
		const storage = createHttpStorage('http://localhost:8787', { fetchImpl })
		await expect(storage.get(sessionKey('boom'))).rejects.toThrow(/HTTP 500/)
	})

	it('syncSessionTo pushes one session to the backend (the sync button path)', async () => {
		const { db, fetchImpl } = mockBackend()
		const id = 'game-sync-1'
		await syncSessionTo('http://localhost:8787', session(id) as never, {
			fetchImpl,
		})
		expect((db.get(id) as { id?: string } | undefined)?.id).toBe(id)
	})

	it('works end-to-end with the real SessionStore (list/save/load/remove)', async () => {
		const { fetchImpl } = mockBackend()
		const storage = createHttpStorage('http://localhost:8787', { fetchImpl })
		const { SessionStore } = await import('./persistence')
		const store = new SessionStore(storage)
		const id = 'game-uuid-9'
		await store.save(session(id) as never)
		expect((await store.list()).map((s) => s.id)).toEqual([id])
		expect((await store.load(id))?.id).toBe(id)
		await store.remove(id)
		expect(await store.load(id)).toBeNull()
	})
})
