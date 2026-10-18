// The Web Worker bot runner (todo/15 §4): requests are correlated by id, an
// abort rejects with an AbortError and terminates the (uninterruptible)
// worker, and the runner falls back to the in-thread runner where no worker
// can be had. The worker itself is faked; botWorker.test.ts drives the real
// message handler.

import { describe, expect, it } from 'vitest'
import type { BotId } from '../bot/types'
import type { Intent } from '../engine/intents'
import type { GameState } from '../engine/state'
import {
	createWorkerRunner,
	isAbortError,
	type BotRunner,
	type WorkerLike,
} from './botRunner'

interface Posted {
	id: number
	botId: BotId
}

class FakeWorker implements WorkerLike {
	onmessage: ((ev: MessageEvent) => void) | null = null
	onerror: ((ev: ErrorEvent) => void) | null = null
	posted: Posted[] = []
	terminated = false
	postMessage(message: unknown): void {
		this.posted.push(message as Posted)
	}
	terminate(): void {
		this.terminated = true
	}
	emit(data: unknown): void {
		this.onmessage?.({ data } as MessageEvent)
	}
	fail(message: string): void {
		this.onerror?.({ message, preventDefault() {} } as ErrorEvent)
	}
}

function fakes() {
	const workers: FakeWorker[] = []
	const createWorker = () => {
		const w = new FakeWorker()
		workers.push(w)
		return w
	}
	return { workers, createWorker }
}

const state = {} as GameState
const legal: Intent[] = [{ t: 'PASS' } as Intent]
const intentA = { t: 'PASS' } as Intent
const intentB = { t: 'END_TURN' } as Intent

/** A fallback runner that records what it was asked. */
function recordingFallback() {
	const asked: BotId[] = []
	let disposed = false
	const runner: BotRunner = {
		decide: (_s, _seat, _legal, botId) => {
			asked.push(botId)
			return Promise.resolve(intentB)
		},
		dispose: () => {
			disposed = true
		},
	}
	return { runner, asked, disposed: () => disposed }
}

describe('createWorkerRunner', () => {
	it('creates the worker lazily and correlates answers by id', async () => {
		const { workers, createWorker } = fakes()
		const runner = createWorkerRunner({ createWorker })
		expect(workers).toHaveLength(0)

		const a = runner.decide(state, 0, legal, 'normal')
		const b = runner.decide(state, 1, legal, 'hard')
		expect(workers).toHaveLength(1)
		const w = workers[0]!
		expect(w.posted.map((m) => m.botId)).toEqual(['normal', 'hard'])
		const [ida, idb] = w.posted.map((m) => m.id)
		expect(ida).not.toBe(idb)

		w.emit({ ready: true })
		// answered out of order: each promise gets its own intent
		w.emit({ id: idb, intent: intentB })
		w.emit({ id: ida, intent: intentA })
		await expect(a).resolves.toEqual(intentA)
		await expect(b).resolves.toEqual(intentB)

		// an unknown id (already settled) is ignored
		w.emit({ id: ida, intent: intentB })
		runner.dispose()
		expect(w.terminated).toBe(true)
	})

	it('rejects with the worker-reported error (not an AbortError)', async () => {
		const { workers, createWorker } = fakes()
		const runner = createWorkerRunner({ createWorker })
		const p = runner.decide(state, 0, legal, 'normal')
		workers[0]!.emit({ id: workers[0]!.posted[0]!.id, error: 'boom' })
		const err = await p.catch((e: unknown) => e)
		expect(err).toBeInstanceOf(Error)
		expect(isAbortError(err)).toBe(false)
		expect((err as Error).message).toContain('boom')
		runner.dispose()
	})

	it('an abort rejects at once, terminates the worker and starts a fresh one next time', async () => {
		const { workers, createWorker } = fakes()
		const runner = createWorkerRunner({ createWorker })
		const ctrl = new AbortController()
		const p = runner.decide(state, 0, legal, 'hard', ctrl.signal)
		const w1 = workers[0]!
		w1.emit({ ready: true })
		ctrl.abort()
		const err = await p.catch((e: unknown) => e)
		expect(isAbortError(err)).toBe(true)
		expect(w1.terminated).toBe(true)
		// a late answer from the dead worker can't reach anyone
		expect(w1.onmessage).toBeNull()

		const q = runner.decide(state, 0, legal, 'normal')
		expect(workers).toHaveLength(2)
		const w2 = workers[1]!
		w2.emit({ id: w2.posted[0]!.id, intent: intentA })
		await expect(q).resolves.toEqual(intentA)
		runner.dispose()
	})

	it('an abort re-posts the other pending requests to the fresh worker', async () => {
		const { workers, createWorker } = fakes()
		const runner = createWorkerRunner({ createWorker })
		const ctrl = new AbortController()
		const aborted = runner.decide(state, 0, legal, 'hard', ctrl.signal)
		const kept = runner.decide(state, 1, legal, 'normal')
		ctrl.abort()
		await expect(aborted).rejects.toSatisfy(isAbortError)
		expect(workers).toHaveLength(2)
		const w2 = workers[1]!
		expect(w2.posted.map((m) => m.botId)).toEqual(['normal'])
		w2.emit({ id: w2.posted[0]!.id, intent: intentB })
		await expect(kept).resolves.toEqual(intentB)
		runner.dispose()
	})

	it('an already-aborted signal rejects without spawning a worker', async () => {
		const { workers, createWorker } = fakes()
		const runner = createWorkerRunner({ createWorker })
		const ctrl = new AbortController()
		ctrl.abort()
		await expect(
			runner.decide(state, 0, legal, 'normal', ctrl.signal),
		).rejects.toSatisfy(isAbortError)
		expect(workers).toHaveLength(0)
	})

	it('dispose terminates the worker and rejects pending requests with AbortError', async () => {
		const { workers, createWorker } = fakes()
		const runner = createWorkerRunner({ createWorker })
		const p = runner.decide(state, 0, legal, 'normal')
		runner.dispose()
		expect(workers[0]!.terminated).toBe(true)
		await expect(p).rejects.toSatisfy(isAbortError)
	})

	it('falls back to the in-thread runner when Worker is undefined', async () => {
		// jsdom has no Worker: the default factory is null
		expect(typeof Worker).toBe('undefined')
		const fb = recordingFallback()
		const runner = createWorkerRunner({ fallback: () => fb.runner })
		await expect(runner.decide(state, 0, legal, 'easy')).resolves.toEqual(
			intentB,
		)
		await expect(runner.decide(state, 0, legal, 'hard')).resolves.toEqual(
			intentB,
		)
		expect(fb.asked).toEqual(['easy', 'hard'])
		runner.dispose()
		expect(fb.disposed()).toBe(true)
	})

	it('falls back when the worker constructor throws', async () => {
		const fb = recordingFallback()
		const runner = createWorkerRunner({
			createWorker: () => {
				throw new Error('no workers here')
			},
			fallback: () => fb.runner,
		})
		await expect(runner.decide(state, 0, legal, 'normal')).resolves.toEqual(
			intentB,
		)
		expect(fb.asked).toEqual(['normal'])
	})

	it('falls back (re-running pending requests) when the worker errors before it is ready', async () => {
		const { workers, createWorker } = fakes()
		const fb = recordingFallback()
		const runner = createWorkerRunner({
			createWorker,
			fallback: () => fb.runner,
		})
		const p = runner.decide(state, 0, legal, 'normal')
		workers[0]!.fail('failed to load chunk')
		await expect(p).resolves.toEqual(intentB)
		expect(workers[0]!.terminated).toBe(true)
		expect(fb.asked).toEqual(['normal'])
		// from now on it stays in-thread
		await runner.decide(state, 0, legal, 'easy')
		expect(workers).toHaveLength(1)
		expect(fb.asked).toEqual(['normal', 'easy'])
	})

	it('a crash after start rejects pending requests and respawns next time', async () => {
		const { workers, createWorker } = fakes()
		const fb = recordingFallback()
		const runner = createWorkerRunner({
			createWorker,
			fallback: () => fb.runner,
		})
		const p = runner.decide(state, 0, legal, 'normal')
		workers[0]!.emit({ ready: true })
		workers[0]!.fail('out of memory')
		const err = await p.catch((e: unknown) => e)
		expect(isAbortError(err)).toBe(false)
		expect(workers[0]!.terminated).toBe(true)
		const next = runner.decide(state, 0, legal, 'normal')
		expect(workers).toHaveLength(2)
		expect(fb.asked).toEqual([])
		runner.dispose()
		await expect(next).rejects.toSatisfy(isAbortError)
	})
})
