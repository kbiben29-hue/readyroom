// Where the house AI thinks (todo/15 §4). The store asks a BotRunner for the
// intent a bot seat plays next and never calls a bot directly, so the
// in-thread default here can be swapped for a Web Worker runner without
// touching the store:
//
//   import { setBotRunner } from './store'
//   setBotRunner(createWorkerRunner())   // the previous runner is disposed
//
// `decide`'s arguments are structured-clone friendly: the GameState and the
// legal intents are plain JSON, the bot is named by its BotId (the worker
// builds its own with makeBot), and no function crosses the boundary. The
// AbortSignal stays on the caller's side: a worker runner listens to it and
// drops (or terminates) the request. The store treats every answer as
// untrusted anyway: it is re-validated, and a stale one (aborted, or for a
// state that is no longer current) is discarded.

import type { BotId, Bot } from '../bot/types'
import { makeBot } from '../bot/index'
import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import type { Seat } from '../engine/resolver/queries'

export interface BotRunner {
	/** The intent `botId` plays for `seat` in `state`. `legal` is
	 *  `legalIntents(state)`. Rejects with an AbortError once `signal` fires. */
	decide(
		state: GameState,
		seat: Seat,
		legal: Intent[],
		botId: BotId,
		signal?: AbortSignal,
	): Promise<Intent>
	/** Release whatever the runner holds (a worker, timers). */
	dispose(): void
}

function abortError(): Error {
	const e = new Error('bot decision aborted')
	e.name = 'AbortError'
	return e
}

export function isAbortError(e: unknown): boolean {
	return e instanceof Error && e.name === 'AbortError'
}

/** The default runner: the bot runs on the main thread, after yielding one
 *  macrotask so the UI paints the previous move (and the "thinking"
 *  indicator) first. */
export function createInThreadRunner(
	factory: (id: BotId) => Bot = makeBot,
): BotRunner {
	const bots = new Map<BotId, Bot>()
	const timers = new Set<ReturnType<typeof setTimeout>>()
	const botOf = (id: BotId): Bot => {
		let bot = bots.get(id)
		if (bot === undefined) {
			bot = factory(id)
			bots.set(id, bot)
		}
		return bot
	}
	return {
		decide(state, seat, legal, botId, signal) {
			return new Promise<Intent>((resolve, reject) => {
				if (signal?.aborted === true) {
					reject(abortError())
					return
				}
				const onAbort = () => {
					clearTimeout(timer)
					timers.delete(timer)
					reject(abortError())
				}
				const timer = setTimeout(() => {
					timers.delete(timer)
					signal?.removeEventListener('abort', onAbort)
					if (signal?.aborted === true) {
						reject(abortError())
						return
					}
					try {
						resolve(botOf(botId).decide(state, seat, legal))
					} catch (e) {
						reject(e instanceof Error ? e : new Error(String(e)))
					}
				}, 0)
				timers.add(timer)
				signal?.addEventListener('abort', onAbort, { once: true })
			})
		},
		dispose() {
			for (const t of timers) clearTimeout(t)
			timers.clear()
			bots.clear()
		},
	}
}
