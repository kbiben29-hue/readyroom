// End-to-end tests for the session backend: boots the real HTTP server on an
// ephemeral port and talks to it with fetch — the same contract the Vite app
// and a future online client use.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileSessionStorage } from './storage'
import { startServer } from './app'

let dataDir: string
let server: Server
let base: string

beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), 'captain-sessions-'))
	const storage = new FileSessionStorage(dataDir)
	server = startServer(storage, 0)
	await new Promise<void>((resolve) =>
		server.once('listening', () => resolve()),
	)
	const addr = server.address()
	if (addr === null || typeof addr === 'string') throw new Error('no port')
	base = `http://127.0.0.1:${addr.port}`
})

afterEach(async () => {
	await new Promise<void>((resolve, reject) =>
		server.close((err) => (err ? reject(err) : resolve())),
	)
	await rm(dataDir, { recursive: true, force: true })
})

const session = (id: string, overrides: Record<string, unknown> = {}) => ({
	version: 1,
	id,
	setup: { mode: 'SOLO', seed: 7 },
	log: [{ t: 'DO_THING' }],
	meta: { updatedAt: '2026-09-22T08:00:00.000Z', result: null },
	...overrides,
})

describe('health and listing', () => {
	it('reports health', async () => {
		const res = await fetch(`${base}/health`)
		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({ ok: true })
	})

	it('lists no sessions on an empty store', async () => {
		const res = await fetch(`${base}/sessions`)
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual([])
	})

	it('lists summaries (id + meta), newest first', async () => {
		await fetch(`${base}/sessions/one`, {
			method: 'PUT',
			body: JSON.stringify(session('one')),
		})
		await fetch(`${base}/sessions/two`, {
			method: 'PUT',
			body: JSON.stringify(
				session('two', { meta: { updatedAt: '2026-09-22T09:00:00.000Z' } }),
			),
		})
		const res = await fetch(`${base}/sessions`)
		expect(res.status).toBe(200)
		const body = (await res.json()) as Array<{ id: string; meta: unknown }>
		expect(body.map((s) => s.id)).toEqual(['two', 'one'])
		expect(body[0]!.meta).toEqual({ updatedAt: '2026-09-22T09:00:00.000Z' })
	})
})

describe('session CRUD', () => {
	it('upserts then reads back exactly what was stored', async () => {
		const put = await fetch(`${base}/sessions/game-abc`, {
			method: 'PUT',
			body: JSON.stringify(session('game-abc')),
		})
		expect(put.status).toBe(200)
		expect(await put.json()).toEqual({ ok: true, id: 'game-abc' })

		const res = await fetch(`${base}/sessions/game-abc`)
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual(session('game-abc'))

		// The file on disk is the same pretty-printed JSON (debuggable by hand).
		const file = `${dataDir}/game-abc.json`
		const { readFile } = await import('node:fs/promises')
		const onDisk = JSON.parse(await readFile(file, 'utf8'))
		expect(onDisk.id).toBe('game-abc')
	})

	it('PUT overwrites (autosave semantics)', async () => {
		await fetch(`${base}/sessions/game-abc`, {
			method: 'PUT',
			body: JSON.stringify(session('game-abc')),
		})
		await fetch(`${base}/sessions/game-abc`, {
			method: 'PUT',
			body: JSON.stringify(
				session('game-abc', { log: [{ t: 'DO_THING' }, { t: 'SECOND' }] }),
			),
		})
		const res = await fetch(`${base}/sessions/game-abc`)
		expect(((await res.json()) as { log: unknown[] }).log).toHaveLength(2)
	})

	it('deletes a session', async () => {
		await fetch(`${base}/sessions/game-abc`, {
			method: 'PUT',
			body: JSON.stringify(session('game-abc')),
		})
		const del = await fetch(`${base}/sessions/game-abc`, { method: 'DELETE' })
		expect(await del.json()).toEqual({
			ok: true,
			id: 'game-abc',
			removed: true,
		})
		const res = await fetch(`${base}/sessions/game-abc`)
		expect(res.status).toBe(404)
	})

	it('404s for a missing session', async () => {
		const res = await fetch(`${base}/sessions/nope`)
		expect(res.status).toBe(404)
	})

	it('supports POST as an upsert alias', async () => {
		const res = await fetch(`${base}/sessions/game-abc`, {
			method: 'POST',
			body: JSON.stringify(session('game-abc')),
		})
		expect(res.status).toBe(200)
		const get = await fetch(`${base}/sessions/game-abc`)
		expect(get.status).toBe(200)
	})
})

describe('input safety', () => {
	it('rejects ids that could escape the data directory', async () => {
		const res = await fetch(`${base}/sessions/..%2F..%2Fetc%2Fpasswd`, {
			method: 'PUT',
			body: JSON.stringify(session('x')),
		})
		expect(res.status).toBe(400)
	})

	it('rejects a body id that differs from the path id', async () => {
		const res = await fetch(`${base}/sessions/path-id`, {
			method: 'PUT',
			body: JSON.stringify(session('body-id')),
		})
		expect(res.status).toBe(400)
		expect(((await res.json()) as { error: string }).error).toMatch(
			/does not match/,
		)
	})

	it('rejects non-JSON bodies and non-object payloads', async () => {
		const bad1 = await fetch(`${base}/sessions/game-abc`, {
			method: 'PUT',
			body: 'not json',
		})
		expect(bad1.status).toBe(400)
		const bad2 = await fetch(`${base}/sessions/game-abc`, {
			method: 'PUT',
			body: JSON.stringify([1, 2, 3]),
		})
		expect(bad2.status).toBe(400)
		const bad3 = await fetch(`${base}/sessions/game-abc`, {
			method: 'PUT',
			body: JSON.stringify({ id: 'game-abc' }),
		})
		expect(bad3.status).toBe(400) // missing version
	})

	it('answers CORS preflight', async () => {
		const res = await fetch(`${base}/sessions`, { method: 'OPTIONS' })
		expect(res.status).toBe(204)
		expect(res.headers.get('access-control-allow-origin')).toBe('*')
		expect(res.headers.get('access-control-allow-methods')).toContain('PUT')
	})

	it('serves the debug page at /', async () => {
		const res = await fetch(`${base}/`)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toContain('text/html')
		expect(await res.text()).toContain('Ready Room — session store')
	})
})
