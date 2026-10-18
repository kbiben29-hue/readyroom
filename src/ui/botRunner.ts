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
import { createBotInThread } from './workerBots'
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
	factory: (id: BotId) => Bot = createBotInThread,
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

// ---------------------------------------------------------------------------
// Web Worker runner
// ---------------------------------------------------------------------------

/** The slice of `Worker` the runner uses (a seam for tests). */
export interface WorkerLike {
	postMessage(message: unknown): void
	terminate(): void
	onmessage: ((ev: MessageEvent) => void) | null
	onerror: ((ev: ErrorEvent) => void) | null
}

export interface WorkerRunnerOptions {
	/** Builds the worker; null when Web Workers are unavailable. Defaults to
	 *  the bundled src/ui/botWorker.ts (null where `Worker` is undefined, e.g.
	 *  jsdom). */
	createWorker?: (() => WorkerLike) | null
	/** The runner used when no worker can be had. */
	fallback?: () => BotRunner
}

function defaultCreateWorker(): (() => WorkerLike) | null {
	if (typeof Worker === 'undefined') return null
	// Vite recognises this exact `new Worker(new URL(…), { type: 'module' })`
	// shape and emits the worker as its own chunk in dev and build alike.
	return () =>
		new Worker(new URL('./botWorker.ts', import.meta.url), {
			type: 'module',
		})
}

interface Pending {
	message: {
		id: number
		state: GameState
		seat: Seat
		legal: Intent[]
		botId: BotId
	}
	resolve: (intent: Intent) => void
	reject: (e: Error) => void
	signal: AbortSignal | undefined
	onAbort: () => void
}

/**
 * The house AI in a Web Worker (src/ui/botWorker.ts), so a long search never
 * blocks the main thread. The worker is created lazily on the first decision
 * and answers are correlated by request id.
 *
 * **Abort.** A bot's `decide` is synchronous and cannot be interrupted, so an
 * abort rejects the request with an AbortError at once and *terminates* the
 * worker: the abandoned search stops burning CPU and can never deliver a late
 * answer. The next decision starts a fresh worker (which re-registers the
 * catalogue — a few milliseconds); any other request still pending on the
 * terminated worker is re-posted to the fresh one.
 *
 * **Fallback.** Where `Worker` is unavailable (jsdom, very old browsers), the
 * constructor throws, or the worker errors before it reports ready (its chunk
 * failed to load, module workers unsupported), the runner permanently
 * delegates to `createInThreadRunner()`; requests pending at that moment are
 * re-run there. An error after the worker started rejects the pending
 * requests (the store then plays its first-legal fallback) and the next
 * decision gets a fresh worker.
 */
export function createWorkerRunner(
	options: WorkerRunnerOptions = {},
): BotRunner {
	const createWorker =
		options.createWorker === undefined
			? defaultCreateWorker()
			: options.createWorker
	const makeFallback = options.fallback ?? (() => createInThreadRunner())

	let fallback: BotRunner | null = null
	let worker: WorkerLike | null = null
	let started = false
	let nextId = 1
	const pending = new Map<number, Pending>()

	const useFallback = (): BotRunner => {
		fallback ??= makeFallback()
		return fallback
	}

	const settle = (id: number): Pending | undefined => {
		const p = pending.get(id)
		if (p === undefined) return undefined
		pending.delete(id)
		p.signal?.removeEventListener('abort', p.onAbort)
		return p
	}

	const kill = () => {
		if (worker === null) return
		worker.onmessage = null
		worker.onerror = null
		worker.terminate()
		worker = null
		started = false
	}

	/** Give up on workers: re-run whatever is pending in-thread. */
	const degrade = () => {
		kill()
		const runner = useFallback()
		for (const id of [...pending.keys()]) {
			const p = settle(id)!
			const m = p.message
			runner
				.decide(m.state, m.seat, m.legal, m.botId, p.signal)
				.then(p.resolve, p.reject)
		}
	}

	const spawn = (): WorkerLike | null => {
		if (createWorker === null) return null
		let w: WorkerLike
		try {
			w = createWorker()
		} catch {
			return null
		}
		w.onmessage = (ev: MessageEvent) => {
			const data = ev.data as
				| { ready: true }
				| { id: number; intent: Intent }
				| { id: number; error: string }
			if ('ready' in data) {
				started = true
				return
			}
			started = true
			const p = settle(data.id)
			if (p === undefined) return // aborted or disposed meanwhile
			if ('error' in data) p.reject(new Error(`bot worker: ${data.error}`))
			else p.resolve(data.intent)
		}
		w.onerror = (ev: ErrorEvent) => {
			ev.preventDefault?.()
			if (!started) {
				degrade()
				return
			}
			kill()
			const err = new Error(`bot worker crashed: ${ev.message ?? 'error'}`)
			for (const id of [...pending.keys()]) settle(id)!.reject(err)
		}
		return w
	}

	/** Post `p` to the live worker, spawning one if needed. False when no
	 *  worker can be had. */
	const post = (p: Pending): boolean => {
		worker ??= spawn()
		if (worker === null) return false
		worker.postMessage(p.message)
		return true
	}

	return {
		decide(state, seat, legal, botId, signal) {
			if (fallback !== null)
				return fallback.decide(state, seat, legal, botId, signal)
			return new Promise<Intent>((resolve, reject) => {
				if (signal?.aborted === true) {
					reject(abortError())
					return
				}
				const id = nextId++
				const p: Pending = {
					message: { id, state, seat, legal, botId },
					resolve,
					reject,
					signal,
					onAbort: () => {
						if (settle(id) === undefined) return
						reject(abortError())
						// the sync search can't be interrupted: drop the worker and
						// move any other pending request onto a fresh one
						kill()
						for (const other of pending.values()) {
							if (!post(other)) {
								degrade()
								return
							}
						}
					},
				}
				pending.set(id, p)
				signal?.addEventListener('abort', p.onAbort, { once: true })
				if (!post(p)) degrade()
			})
		},
		dispose() {
			kill()
			for (const id of [...pending.keys()]) settle(id)!.reject(abortError())
			fallback?.dispose()
			fallback = null
		},
	}
}
