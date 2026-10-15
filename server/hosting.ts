// What a hosted server needs beyond the API (docs/deploy.md): serving the
// built app from the same origin, and a per-client request budget.
//
//   serveStatic   GET/HEAD a file under `dist/`; `/` and unknown extension-less
//                 paths get index.html (the app routes by hash, so that is
//                 only ever `/`). Hashed `/assets/*` are cached for a year.
//   RateLimiter   fixed-window counter per client key — enough to keep one
//                 client from hammering game creation or the engine.

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain; charset=utf-8',
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile()
	} catch {
		return false
	}
}

/** Serve `pathname` from `root`. Returns false when there is nothing to serve
 *  (the caller answers 404). Never leaves `root`. */
export async function serveStatic(
	root: string,
	pathname: string,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<boolean> {
	if (req.method !== 'GET' && req.method !== 'HEAD') return false
	const base = resolve(root)
	let rel: string
	try {
		rel = decodeURIComponent(pathname)
	} catch {
		return false
	}
	let file = resolve(base, `.${sep}${normalize(rel)}`)
	if (file !== base && !file.startsWith(base + sep)) return false
	if (!(await isFile(file))) {
		// Only page-like paths fall back to the app; a missing asset is a 404.
		if (extname(rel) !== '') return false
		file = join(base, 'index.html')
		if (!(await isFile(file))) return false
	}
	const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
	const cache = rel.startsWith('/assets/')
		? 'public, max-age=31536000, immutable'
		: 'no-cache'
	res.writeHead(200, { 'content-type': type, 'cache-control': cache })
	if (req.method === 'HEAD') {
		res.end()
		return true
	}
	await new Promise<void>((done, fail) => {
		createReadStream(file).on('error', fail).on('end', done).pipe(res)
	})
	return true
}

export interface RateLimit {
	/** requests allowed per window */
	limit: number
	windowMs: number
}

/** Fixed-window request counter per key. */
export class RateLimiter {
	private readonly hits = new Map<string, { start: number; count: number }>()

	constructor(
		private readonly rule: RateLimit,
		private readonly now: () => number = Date.now,
	) {}

	/** Count one request; false when the key is over its budget. */
	allow(key: string): boolean {
		const t = this.now()
		const entry = this.hits.get(key)
		if (entry === undefined || t - entry.start >= this.rule.windowMs) {
			if (this.hits.size > 10_000) this.prune(t)
			this.hits.set(key, { start: t, count: 1 })
			return true
		}
		entry.count += 1
		return entry.count <= this.rule.limit
	}

	private prune(t: number): void {
		for (const [key, entry] of this.hits)
			if (t - entry.start >= this.rule.windowMs) this.hits.delete(key)
	}
}

/** The client address; behind Fly's proxy that is `Fly-Client-IP`. */
export function clientKey(req: IncomingMessage, trustProxy: boolean): string {
	if (trustProxy) {
		const fly = req.headers['fly-client-ip']
		if (typeof fly === 'string' && fly !== '') return fly
		const fwd = req.headers['x-forwarded-for']
		if (typeof fwd === 'string' && fwd !== '') return fwd.split(',')[0]!.trim()
	}
	return req.socket.remoteAddress ?? 'unknown'
}
