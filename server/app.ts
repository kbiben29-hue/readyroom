// HTTP surface for the session store (server/README.md). One `createHandler`
// request listener — dependency-free over node:http — with:
//
//   GET    /health                 → { ok: true }
//   GET    /                       → debug page (index.html below)
//   GET    /sessions               → [{ id, meta }] summaries, newest first
//   GET    /sessions/:id           → the full session JSON (or 404)
//   PUT    /sessions/:id           → upsert session from JSON body (or POST)
//   DELETE /sessions/:id           → remove a session
//
// plus, when a GameService is passed, the authoritative online games
// (server/games.ts; the route table is in server/README.md):
//
//   POST   /games                  → create; returns the two seat tokens
//                                     ({ host } alone: an invite, see join)
//   POST   /games/summaries        → inbox rows for [{ gameId, token }]
//   GET    /games/:id              → the seat's view
//   GET    /games/:id/lobby        → open invite or started game, who hailed
//   POST   /games/:id/join         → the invite's seat picks its captain
//   POST   /games/:id/intents      → submit { intent, version }
//   POST   /games/:id/undo         → undo { version }
//   PUT    /games/:id/orders       → standing order { cardDef, policy }
//   GET    /games/:id/recap        → "Previously on…" (?since=seq)
//   GET    /games/:id/events       → Server-Sent Events (?token=…)
//
// Game routes authenticate with `Authorization: Bearer <seat token>` (the
// event stream also takes `?token=`, since EventSource cannot set headers).
//
// CORS is open (Access-Control-Allow-Origin: *) so the Vite dev server and
// the online client (src/session/online.ts) can talk to it from anywhere.

import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from 'node:http'
import type { FileSessionStorage } from './storage'
import { GameError, type GameService } from './games'
import { RateLimiter, clientKey, serveStatic, type RateLimit } from './hosting'

export const MAX_BODY_BYTES = 10 * 1024 * 1024
/** Game requests are small JSON (an intent, a list of tokens). */
export const MAX_GAME_BODY_BYTES = 256 * 1024

export interface HandlerOptions {
	/** mounts the /games routes */
	games?: GameService | undefined
	/** mounts the /sessions debug store and its page at `/` (default true);
	 *  off on a public host — it has no authentication */
	sessions?: boolean | undefined
	/** serves the built app (`dist/`) at `/` from the same origin */
	staticDir?: string | undefined
	/** per-client budgets for the API routes (docs/deploy.md) */
	rateLimit?:
		{ api: RateLimit; create: RateLimit; trustProxy: boolean } | undefined
}

/** Game ids look like `game-<uuid>`; keep the set tight and URL-safe so a path
 *  segment can never escape the data directory. */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

class BodyTooLargeError extends Error {}

function validSessionId(id: string): boolean {
	return SESSION_ID_RE.test(id) && !id.includes('..') && !id.startsWith('.')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
	res.end(JSON.stringify(body, null, 2))
}

function sendText(
	res: ServerResponse,
	status: number,
	body: string,
	contentType = 'text/plain; charset=utf-8',
): void {
	res.writeHead(status, { 'content-type': contentType })
	res.end(body)
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
	res.setHeader('access-control-allow-origin', '*')
	res.setHeader(
		'access-control-allow-methods',
		'GET, POST, PUT, DELETE, OPTIONS',
	)
	res.setHeader('access-control-allow-headers', 'Content-Type, Authorization')
	res.setHeader('access-control-max-age', '86400')
	void req
}

function readBody(
	req: IncomingMessage,
	limit: number = MAX_BODY_BYTES,
): Promise<string> {
	return new Promise((resolve, reject) => {
		let size = 0
		const chunks: Buffer[] = []
		req.on('data', (chunk: Buffer) => {
			size += chunk.length
			if (size > limit) {
				reject(new BodyTooLargeError(`request body exceeds ${limit} bytes`))
				req.destroy()
				return
			}
			chunks.push(chunk)
		})
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
		req.on('error', reject)
	})
}

/** Session-shaped payload check for upserts. Permissive on purpose: the store
 *  is a debugging/multiplayer seam, not a forward-compatibility gate — the
 *  client's parseSession owns strict versioning. We only require what the
 *  server itself needs: an id (path id wins) and a version number. */
function coerceUpsert(
	raw: unknown,
	pathId: string,
):
	| { ok: true; session: Record<string, unknown> }
	| { ok: false; reason: string } {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return { ok: false, reason: 'body must be a JSON object' }
	}
	const session = { ...(raw as Record<string, unknown>) }
	const bodyId = session.id
	if (bodyId !== undefined && bodyId !== pathId) {
		return {
			ok: false,
			reason: `body.id "${String(bodyId)}" does not match path id "${pathId}"`,
		}
	}
	if (typeof session.version !== 'number') {
		return { ok: false, reason: 'session.version must be a number' }
	}
	session.id = pathId
	return { ok: true, session }
}

function handleSessionsPath(
	storage: FileSessionStorage,
): (req: IncomingMessage, res: ServerResponse, rest: string) => Promise<void> {
	return async (req, res, rest) => {
		const [, rawId] = rest.split('/')
		const id = rawId ?? ''

		if (id === '' && (req.method === 'GET' || req.method === 'HEAD')) {
			// Summaries (id + full meta) — small enough for a debug page and for the
			// remote Storage.keys() implementation to list without downloading every
			// log. HEAD answers the same headers as GET with an empty body.
			const sessions = await storage.list()
			const summaries = sessions.map((s) => ({
				id: s.id,
				meta: s.meta ?? null,
			}))
			const body = JSON.stringify(summaries, null, 2)
			res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
			res.end(req.method === 'HEAD' ? undefined : body)
			return
		}

		if (!validSessionId(id)) {
			sendJson(res, 400, { ok: false, error: `invalid session id "${id}"` })
			return
		}

		const method = req.method ?? 'GET'
		switch (method) {
			case 'GET':
			case 'HEAD': {
				const session = await storage.get(id)
				if (session === null) {
					sendJson(res, 404, { ok: false, error: `no session "${id}"` })
					return
				}
				const body = JSON.stringify(session, null, 2)
				res.writeHead(200, {
					'content-type': 'application/json; charset=utf-8',
				})
				res.end(method === 'HEAD' ? undefined : body)
				return
			}
			case 'PUT':
			case 'POST': {
				let text: string
				try {
					text = await readBody(req)
				} catch (err) {
					sendJson(res, err instanceof BodyTooLargeError ? 413 : 400, {
						ok: false,
						error: (err as Error).message,
					})
					return
				}
				let raw: unknown
				try {
					raw = JSON.parse(text)
				} catch (err) {
					sendJson(res, 400, {
						ok: false,
						error: `body is not valid JSON (${(err as Error).message})`,
					})
					return
				}
				const coerced = coerceUpsert(raw, id)
				if (!coerced.ok) {
					sendJson(res, 400, { ok: false, error: coerced.reason })
					return
				}
				await storage.save(coerced.session as import('./storage').StoredSession)
				sendJson(res, 200, { ok: true, id })
				return
			}
			case 'DELETE': {
				const removed = await storage.remove(id)
				sendJson(res, 200, { ok: true, id, removed })
				return
			}
			default:
				sendJson(res, 405, { ok: false, error: `method ${method} not allowed` })
		}
	}
}

/** `Authorization: Bearer <token>` (or `?token=` where allowed). */
function seatToken(
	req: IncomingMessage,
	url: URL,
	allowQuery: boolean,
): string {
	const header = req.headers.authorization
	if (typeof header === 'string' && header.startsWith('Bearer '))
		return header.slice('Bearer '.length).trim()
	if (allowQuery) return url.searchParams.get('token') ?? ''
	return ''
}

async function readJson(req: IncomingMessage): Promise<unknown> {
	let text: string
	try {
		text = await readBody(req, MAX_GAME_BODY_BYTES)
	} catch (err) {
		if (err instanceof BodyTooLargeError)
			throw new GameError(413, 'TOO_LARGE', err.message)
		throw new GameError(400, 'BAD_REQUEST', (err as Error).message)
	}
	try {
		return JSON.parse(text) as unknown
	} catch (err) {
		throw new GameError(
			400,
			'BAD_REQUEST',
			`body is not valid JSON (${(err as Error).message})`,
		)
	}
}

/** The /games routes (server/games.ts). Throws GameError for refusals. */
async function handleGamesPath(
	games: GameService,
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
): Promise<void> {
	const method = req.method ?? 'GET'
	const parts = url.pathname.split('/').filter((p) => p !== '') // ['games', …]
	const [, id, action] = parts
	const notAllowed = (): never => {
		throw new GameError(
			405,
			'BAD_REQUEST',
			`method ${method} not allowed on ${url.pathname}`,
		)
	}
	if (parts.length > 3) {
		throw new GameError(
			404,
			'NOT_FOUND',
			`no route for ${method} ${url.pathname}`,
		)
	}
	if (id === undefined) {
		if (method !== 'POST') notAllowed()
		sendJson(res, 201, await games.create(await readJson(req)))
		return
	}
	if (id === 'summaries' && action === undefined) {
		if (method !== 'POST') notAllowed()
		sendJson(res, 200, await games.summaries(await readJson(req)))
		return
	}
	const gameId = decodeURIComponent(id)
	const token = seatToken(req, url, action === 'events')
	switch (action) {
		case undefined:
			if (method !== 'GET') notAllowed()
			sendJson(res, 200, await games.view(gameId, token))
			return
		case 'lobby':
			if (method !== 'GET') notAllowed()
			sendJson(res, 200, await games.lobby(gameId, token))
			return
		case 'join':
			if (method !== 'POST') notAllowed()
			sendJson(res, 200, await games.join(gameId, token, await readJson(req)))
			return
		case 'intents':
			if (method !== 'POST') notAllowed()
			sendJson(res, 200, await games.submit(gameId, token, await readJson(req)))
			return
		case 'undo':
			if (method !== 'POST') notAllowed()
			sendJson(res, 200, await games.undo(gameId, token, await readJson(req)))
			return
		case 'orders':
			if (method !== 'PUT' && method !== 'POST') notAllowed()
			sendJson(
				res,
				200,
				await games.setOrder(gameId, token, await readJson(req)),
			)
			return
		case 'recap': {
			if (method !== 'GET') notAllowed()
			const raw = url.searchParams.get('since')
			const since = raw === null ? undefined : Number.parseInt(raw, 10)
			if (since !== undefined && (!Number.isInteger(since) || since < 0))
				throw new GameError(
					400,
					'BAD_REQUEST',
					'since must be a sequence number',
				)
			sendJson(res, 200, await games.recap(gameId, token, since))
			return
		}
		case 'events':
			if (method !== 'GET') notAllowed()
			await games.openStream(gameId, token, req, res)
			return
		default:
			throw new GameError(
				404,
				'NOT_FOUND',
				`no route for ${method} ${url.pathname}`,
			)
	}
}

export function createHandler(
	storage: FileSessionStorage,
	opts: HandlerOptions = {},
) {
	const sessions = opts.sessions ?? true
	const limits =
		opts.rateLimit === undefined
			? null
			: {
					api: new RateLimiter(opts.rateLimit.api),
					create: new RateLimiter(opts.rateLimit.create),
					trustProxy: opts.rateLimit.trustProxy,
				}
	return async function requestListener(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		applyCors(req, res)
		const url = new URL(req.url ?? '/', 'http://localhost')
		const { pathname } = url

		if (req.method === 'OPTIONS') {
			res.writeHead(204)
			res.end()
			return
		}

		const isApi =
			pathname.startsWith('/games') || pathname.startsWith('/sessions')
		if (limits !== null && isApi) {
			const key = clientKey(req, limits.trustProxy)
			const creating = pathname === '/games' && req.method === 'POST'
			if (!limits.api.allow(key) || (creating && !limits.create.allow(key))) {
				res.setHeader('retry-after', '60')
				sendJson(res, 429, {
					ok: false,
					code: 'RATE_LIMITED',
					error: 'too many requests, try again in a minute',
				})
				return
			}
		}

		try {
			switch (true) {
				case pathname === '/health':
					sendJson(
						res,
						200,
						sessions ? { ok: true, store: storage.dataDir } : { ok: true },
					)
					return
				case pathname === '/' && sessions && opts.staticDir === undefined:
					sendText(res, 200, indexHtml, 'text/html; charset=utf-8')
					return
				case sessions &&
					(pathname === '/sessions' || pathname.startsWith('/sessions/')): {
					const handler = handleSessionsPath(storage)
					await handler(req, res, pathname.slice('/sessions'.length))
					return
				}
				case opts.games !== undefined &&
					(pathname === '/games' || pathname.startsWith('/games/')):
					await handleGamesPath(opts.games!, req, res, url)
					return
				case opts.staticDir !== undefined &&
					!isApi &&
					(await serveStatic(opts.staticDir, pathname, req, res)):
					return
				default:
					sendJson(res, 404, {
						ok: false,
						error: `no route for ${req.method ?? 'GET'} ${pathname}`,
					})
			}
		} catch (err) {
			if (res.headersSent) {
				res.end()
				return
			}
			if (err instanceof GameError) {
				sendJson(res, err.status, {
					ok: false,
					code: err.code,
					error: err.message,
					...err.extra,
				})
				return
			}
			const message = (err as Error).message
			if (pathname.startsWith('/games')) {
				// Engine errors can name real card ids — never echo them to a seat.
				console.error(`${req.method ?? 'GET'} ${pathname}: ${message}`)
				sendJson(res, 500, {
					ok: false,
					code: 'INTERNAL',
					error: 'internal error',
				})
				return
			}
			sendJson(res, 500, { ok: false, error: message })
		}
	}
}

export function startServer(
	storage: FileSessionStorage,
	port: number,
	host = '127.0.0.1',
	opts: HandlerOptions = {},
) {
	return createServer(createHandler(storage, opts)).listen(port, host)
}

const indexHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ready Room — session store</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; max-width: 72ch; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.25rem; }
  a { color: #3b82f6; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #8884; padding: .35rem .6rem; text-align: left; vertical-align: top; }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: #888; }
  .empty { color: #888; }
  code { background: #8882; padding: .1rem .3rem; border-radius: 4px; }
  textarea { width: 100%; min-height: 120px; font: inherit; box-sizing: border-box; }
  button { font: inherit; cursor: pointer; padding: .3rem .7rem; }
  #msg { min-height: 1.4em; color: #16a34a; }
  #msg.err { color: #dc2626; }
  #raw { white-space: pre-wrap; }
</style>
</head>
<body>
<h1>Ready Room — session store</h1>
<p>Sessions live as one JSON file per game in <code>data/sessions/</code>.
See <a href="server/README.md" >README</a> for the full API.</p>
<h2>Sessions (<span id="count">0</span>)</h2>
<table id="rows">
  <thead><tr><th>id</th><th>updated</th><th>turn / phase</th><th>decks</th><th>result</th><th></th></tr></thead>
  <tbody></tbody>
</table>
<p class="empty" id="empty">no sessions yet</p>
<h2>Upsert from JSON</h2>
<p>Paste a session (e.g. an exported <code>.session.json</code>) and hit save to push it to the backend.</p>
<textarea id="paste" placeholder='{"version": 2, "id": "game-…", "setup": …, "log": […], "meta": …}'></textarea>
<p><button id="save">Save / update</button> <span id="msg"></span></p>
<pre id="raw" hidden></pre>
<script>
  const $ = (id) => document.getElementById(id)
  async function refresh() {
    const res = await fetch('/sessions')
    const rows = await res.json()
    $('count').textContent = rows.length
    const tbody = $('rows').querySelector('tbody')
    tbody.innerHTML = ''
    $('empty').hidden = rows.length > 0
    for (const s of rows) {
      const m = s.meta || {}
      const tr = document.createElement('tr')
      const phase = m.result ? 'over' : (m.phase && m.turnNumber ? m.turnNumber + ' · ' + m.phase : '')
      tr.innerHTML = '<td><a href="/sessions/' + encodeURIComponent(s.id) + '">' + s.id + '</a></td>'
        + '<td>' + (m.updatedAt ? new Date(m.updatedAt).toISOString().slice(0, 19).replace('T', ' ') : '') + '</td>'
        + '<td>' + (phase || '–') + '</td>'
        + '<td>' + ((m.deckNames || []).join(' vs ')) + '</td>'
        + '<td>' + (m.result || '–') + '</td>'
        + '<td><button data-del="' + encodeURIComponent(s.id) + '">delete</button></td>'
      tbody.appendChild(tr)
    }
    for (const b of tbody.querySelectorAll('[data-del]')) {
      b.addEventListener('click', async () => {
        await fetch('/sessions/' + b.dataset.del, { method: 'DELETE' })
        refresh()
      })
    }
  }
  $('save').addEventListener('click', async () => {
    const msg = $('msg')
    try {
      const session = JSON.parse($('paste').value)
      if (!session.id) { msg.textContent = 'session JSON needs an id'; msg.className = 'err'; return }
      const res = await fetch('/sessions/' + encodeURIComponent(session.id), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(session),
      })
      const out = await res.json()
      if (!res.ok) throw new Error(out.error || res.statusText)
      msg.textContent = 'saved ' + out.id
      msg.className = ''
      $('paste').value = ''
      refresh()
    } catch (err) {
      msg.textContent = err.message
      msg.className = 'err'
    }
  })
  refresh()
</script>
</body>
</html>`
