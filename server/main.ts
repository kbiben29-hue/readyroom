// Entry point: `npm run server` (or `tsx server/main.ts`).
//
//   --port 1234   listen port            (default 8787)
//   --host 0.0.0.0  bind address         (default 127.0.0.1 — use 0.0.0.0 when a
//                                        friend's device needs to reach you)
//   --data ./path  session data dir      (default ./server/data/sessions)
//   --games ./path online game dir       (default ./server/data/games)
//   --static ./dist  also serve the built app from this directory
//   --public       hosted mode (docs/deploy.md): no /sessions debug store,
//                  per-client rate limits, client address from the proxy

import { FileSessionStorage } from './storage'
import { startServer } from './app'
import { GameService } from './games'
import { loadCatalog } from '../src/data/catalog'
import { loadStccNode } from '../tools/stcc-node'
import { resolve } from 'node:path'

function argAfter(name: string, fallback: string): string {
	const i = process.argv.indexOf(name)
	return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : fallback
}

const port = Number.parseInt(argAfter('--port', '8787'), 10)
const host = argAfter('--host', '127.0.0.1')
const dataDir = resolve(argAfter('--data', './server/data/sessions'))
const gamesDir = resolve(argAfter('--games', './server/data/games'))
const staticArg = argAfter('--static', '')
const staticDir = staticArg === '' ? undefined : resolve(staticArg)
const hosted = process.argv.includes('--public')

// card names for lobby labels (session meta); card numbers when not fetched
await loadStccNode()

const storage = new FileSessionStorage(dataDir)
const games = await GameService.open({
	dir: gamesDir,
	catalog: await loadCatalog(),
})
startServer(storage, port, host, {
	games,
	staticDir,
	sessions: !hosted,
	rateLimit: hosted
		? {
				api: { limit: 600, windowMs: 60_000 },
				create: { limit: 20, windowMs: 60 * 60_000 },
				trustProxy: true,
			}
		: undefined,
})

console.log(
	`Ready Room ${hosted ? 'online games (public)' : 'session store + online games'}`,
)
if (staticDir !== undefined)
	console.log(`  app      http://${host}:${port}/  (${staticDir})`)
else if (!hosted)
	console.log(`  url      http://${host}:${port}/  (debug page)`)
if (!hosted) console.log(`  api      http://${host}:${port}/sessions  (JSON)`)
console.log(`  games    http://${host}:${port}/games  (seat tokens required)`)
if (!hosted) console.log(`  data     ${dataDir}`)
console.log(`  games    ${gamesDir}`)
