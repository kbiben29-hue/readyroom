// The house-AI Web Worker (todo/15 §4). The main thread's worker runner
// (src/ui/botRunner.ts `createWorkerRunner`) posts a decision request and the
// worker answers with the intent, so a slow search (Hard) never blocks the UI.
//
//   main → worker   { id, state, seat, legal, botId }
//   worker → main   { id, intent } | { id, error }    (and { ready: true } once
//                                                       the module has loaded)
//
// The worker is its own module graph: the engine's card registry
// (src/engine/cards.ts) is empty here until we register the catalogue. The
// card definitions are our own JSON (src/data/cards/), bundled by
// `loadBrowserCatalog`'s `import.meta.glob` in every build mode (dev, the
// hosted web build and `--mode desktop` alike), so no fetch is needed. The
// fetched STCC data (names, printed text, scans) is display-only and is never
// loaded here: the engine and the bots don't read it.
//
// `handleBotRequest` is exported separately from the `self.onmessage` wiring
// so tests can drive it directly; the wiring only runs inside a worker.

import type { BotId, Bot } from '../bot/types'
import { registerCards } from '../engine/cards'
import type { Intent } from '../engine/intents'
import type { Seat } from '../engine/resolver/queries'
import type { GameState } from '../engine/state'
import { loadBrowserCatalog } from './browserCatalog'
import { createBotForWorker } from './workerBots'

export interface BotRequest {
	id: number
	state: GameState
	seat: Seat
	legal: Intent[]
	botId: BotId
}

export type BotResponse =
	{ id: number; intent: Intent } | { id: number; error: string }

/** Posted once when the worker module has evaluated (the runner's proof that
 *  the worker started). */
export interface BotWorkerReady {
	ready: true
}

let catalogReady = false
const bots = new Map<BotId, Bot>()

/** Register the card catalogue with this thread's engine (once). */
function ensureCatalog(): void {
	if (catalogReady) return
	const catalog = loadBrowserCatalog()
	registerCards([...catalog.defs, ...catalog.stardates.map((s) => s.def)])
	catalogReady = true
}

function botOf(id: BotId): Bot {
	let bot = bots.get(id)
	if (bot === undefined) {
		bot = createBotForWorker(id)
		bots.set(id, bot)
	}
	return bot
}

/** Answer one decision request. Never throws: any failure (catalogue, bot)
 *  comes back as `{ id, error }`. */
export function handleBotRequest(req: BotRequest): BotResponse {
	const id = typeof req?.id === 'number' ? req.id : -1
	try {
		ensureCatalog()
		const intent = botOf(req.botId).decide(req.state, req.seat, req.legal)
		return { id, intent }
	} catch (e) {
		return { id, error: e instanceof Error ? e.message : String(e) }
	}
}

/** The bits of DedicatedWorkerGlobalScope we use (the app's tsconfig has the
 *  DOM lib, not WebWorker). */
interface WorkerScope {
	onmessage: ((ev: MessageEvent<BotRequest>) => void) | null
	postMessage(message: BotResponse | BotWorkerReady): void
}

declare const WorkerGlobalScope: (abstract new () => unknown) | undefined

if (
	typeof WorkerGlobalScope !== 'undefined' &&
	self instanceof WorkerGlobalScope
) {
	const scope = self as unknown as WorkerScope
	scope.onmessage = (ev) => {
		scope.postMessage(handleBotRequest(ev.data))
	}
	scope.postMessage({ ready: true })
}
