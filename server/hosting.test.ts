// Hosted mode (docs/deploy.md): the built app served from the same origin,
// the /sessions debug store switched off, and per-client rate limits.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileSessionStorage } from './storage'
import { startServer, type HandlerOptions } from './app'
import { RateLimiter } from './hosting'

let dir: string
let server: Server | undefined
let base: string

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'captain-hosting-'))
	await mkdir(join(dir, 'dist', 'assets'), { recursive: true })
	await writeFile(join(dir, 'dist', 'index.html'), '<!doctype html><p>app')
	await writeFile(join(dir, 'dist', 'assets', 'app-1234.js'), 'export {}')
	await writeFile(join(dir, 'secret.txt'), 'outside dist')
})

afterEach(async () => {
	if (server !== undefined)
		await new Promise<void>((resolve, reject) =>
			server!.close((err) => (err ? reject(err) : resolve())),
		)
	server = undefined
	await rm(dir, { recursive: true, force: true })
})

async function boot(opts: HandlerOptions): Promise<void> {
	server = startServer(
		new FileSessionStorage(join(dir, 'sessions')),
		0,
		'127.0.0.1',
		opts,
	)
	await new Promise<void>((resolve) =>
		server!.once('listening', () => resolve()),
	)
	const addr = server.address()
	if (addr === null || typeof addr === 'string') throw new Error('no port')
	base = `http://127.0.0.1:${addr.port}`
}

describe('serving the built app', () => {
	beforeEach(() => boot({ staticDir: join(dir, 'dist'), sessions: false }))

	it('serves index.html at / instead of the debug page', async () => {
		const res = await fetch(`${base}/`)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toContain('text/html')
		expect(await res.text()).toContain('<p>app')
	})

	it('serves hashed assets with a long cache', async () => {
		const res = await fetch(`${base}/assets/app-1234.js`)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toContain('javascript')
		expect(res.headers.get('cache-control')).toContain('immutable')
	})

	it('404s a missing asset rather than answering with the app', async () => {
		expect((await fetch(`${base}/assets/nope.js`)).status).toBe(404)
	})

	it('never serves files outside the app directory', async () => {
		for (const path of [
			'/../secret.txt',
			'/%2e%2e/secret.txt',
			'/..%2fsecret.txt',
		]) {
			const res = await fetch(`${base}${path}`)
			expect(await res.text()).not.toContain('outside dist')
		}
	})

	it('switches the unauthenticated session store off', async () => {
		expect((await fetch(`${base}/sessions`)).status).toBe(404)
		const put = await fetch(`${base}/sessions/one`, {
			method: 'PUT',
			body: JSON.stringify({ version: 1 }),
		})
		expect(put.status).toBe(404)
		expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true })
	})
})

describe('rate limits', () => {
	it('answers 429 once a client is over its API budget', async () => {
		await boot({
			sessions: false,
			rateLimit: {
				api: { limit: 2, windowMs: 60_000 },
				create: { limit: 1, windowMs: 60_000 },
				trustProxy: false,
			},
		})
		expect((await fetch(`${base}/sessions`)).status).toBe(404)
		expect((await fetch(`${base}/sessions`)).status).toBe(404)
		const res = await fetch(`${base}/sessions`)
		expect(res.status).toBe(429)
		expect(await res.json()).toMatchObject({ code: 'RATE_LIMITED' })
		// the app itself is not counted
		expect((await fetch(`${base}/health`)).status).toBe(200)
	})

	it('opens a new window after the old one ends', () => {
		let t = 0
		const limiter = new RateLimiter({ limit: 1, windowMs: 1000 }, () => t)
		expect(limiter.allow('a')).toBe(true)
		expect(limiter.allow('a')).toBe(false)
		expect(limiter.allow('b')).toBe(true)
		t = 1000
		expect(limiter.allow('a')).toBe(true)
	})
})
