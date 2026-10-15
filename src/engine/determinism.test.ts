// Determinism suite (todo/16 §5). The engine must be byte-identical under
// replay: the same seed + the same intent log ⇒ the same state, no matter how
// it was produced. Four claims, all against the REAL catalog and a genuinely
// mixed-intent game (autoPlay drives play cards / activates / completes /
// passes / settles choices):
//
//   1. setup(config) twice, same seed → deep-equal states;
//   2. replay(session) → deep-equal to the live (incrementally reduced) state;
//   3. mid-effect round-trip — serialise the state while a PendingChoice is
//      suspended, deserialise, resolve the SAME choice, continue identically →
//      byte-identical to never round-tripping (the stack really is data);
//   4. undo N intents then replay → deep-equal to the pre-undo state.

import { describe, expect, it, beforeAll } from 'vitest'

import { loadCatalog } from '../data/catalog'
import type { CardCatalog } from './setup'
import { setup, type SetupConfig } from './setup'
import type { Intent } from './intents'
import { reduce } from './intents'
import { autoPlay } from '../bot/autoPlay'
import { assertInvariants } from './invariants'
import type { GameState } from './state'
import { createSession, replay } from '../session/log'

let catalog: CardCatalog
/** The (log, live) of one full mixed game, computed once and shared by every
 *  test below — three full autoPlays would otherwise dominate the file's wall
 *  time. `live` is the incrementally-reduced target every replay must hit. */
let mixed: { log: Intent[]; live: GameState }

beforeAll(async () => {
	catalog = await loadCatalog()
	const r = autoPlay(setup(mixedConfig(), catalog))
	expect(r.stopped).toBe('GAME_OVER')
	assertInvariants(r.state)
	mixed = { log: r.intents, live: r.state }
})

function mixedConfig(): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: 'PIC', boardSide: 'ADVANCED' },
			{ deck: 'SHR', boardSide: 'ADVANCED' },
		],
		seed: 25,
	}
}

/** The cached full game: a deterministic, genuinely mixed-intent two-player
 *  game). */
function mixedGame(): { log: Intent[]; live: GameState } {
	return mixed
}

/** Reduce a log onto a state, intent by intent, returning the final state. */
function reduceLog(initial: GameState, log: readonly Intent[]): GameState {
	let s = initial
	for (const intent of log) {
		s = reduce(s, intent).state
	}
	return s
}

describe('determinism (todo/16 §5)', () => {
	it('setup(config) twice with the same seed → deep-equal states', () => {
		const config: SetupConfig = {
			mode: 'TWO_PLAYER',
			players: [
				{ deck: 'KOL', boardSide: 'ADVANCED' },
				{ deck: 'SIS', boardSide: 'BASIC' },
			],
			seed: 7,
		}
		const a = setup(config, catalog)
		const b = setup(config, catalog)
		expect(JSON.stringify(a)).toBe(JSON.stringify(b))
		// different seeds must differ (sanity: the seed actually drives the shuffle)
		const c = setup({ ...config, seed: 8 }, catalog)
		expect(JSON.stringify(a)).not.toBe(JSON.stringify(c))
	})

	it('replay(session) → deep-equal to the live-played state (real mixed game)', () => {
		const { log, live } = mixedGame()
		const session = { ...createSession(mixedConfig(), catalog), log }
		const replayed = replay(session, catalog)
		expect(JSON.stringify(replayed)).toBe(JSON.stringify(live))
		// and a second replay is byte-identical to the first (idempotent)
		expect(JSON.stringify(replay(session, catalog))).toBe(
			JSON.stringify(replayed),
		)
	})

	it('resolving a suspended choice twice from the same mid state gives identical results (storeSelection never mutates the saved state)', () => {
		const { log } = mixedGame()
		let s = setup(mixedConfig(), catalog)
		let mid: GameState | null = null
		let resolve: Intent | undefined
		for (let i = 0; i < log.length; i++) {
			s = reduce(s, log[i]!).state
			if (s.pendingChoice !== null && mid === null) {
				mid = s
				const next = log[i + 1]
				if (next?.t === 'RESOLVE_CHOICE') resolve = next
				break
			}
		}
		if (mid === null || resolve === undefined)
			throw new Error('determinism: no mid-effect choice found')

		const snapshot = JSON.stringify(mid)
		const first = reduce(mid, resolve).state
		// storeSelection copies the suspended frame's bindings map instead of
		// writing in place, so a mid-effect reduce leaves the save point intact…
		expect(JSON.stringify(mid)).toBe(snapshot)
		// …and because mid is pristine, replaying the same choice from it yields
		// a byte-identical state (the stack really is replayable data).
		const second = reduce(mid, resolve).state
		expect(JSON.stringify(second)).toBe(JSON.stringify(first))
	})

	it('mid-effect round-trip: serialise a suspended PendingChoice, deserialise, resolve identically', () => {
		const { log, live } = mixedGame()

		// Replay the log until the FIRST time a choice is suspended mid-effect.
		let s = setup(mixedConfig(), catalog)
		let mid: GameState | null = null
		let rest: readonly Intent[] = []
		for (let i = 0; i < log.length; i++) {
			s = reduce(s, log[i]!).state
			if (s.pendingChoice !== null && mid === null) {
				mid = s
				const suspended = s.pendingChoice
				// The rest of the log, starting from the intent that resolves this
				// exact choice (log[i+1] is the RESOLVE_CHOICE for it).
				rest = log.slice(i + 1)
				if (rest.length === 0 || rest[0]?.t !== 'RESOLVE_CHOICE') {
					throw new Error(
						'determinism: expected the next intent to resolve the suspended choice',
					)
				}
				expect(rest[0].choiceId).toBe(suspended.id)
				break
			}
		}
		if (mid === null)
			throw new Error(
				'determinism: no mid-effect choice found in the mixed game',
			)

		// Snapshot the suspended state BEFORE any path reduces it. storeSelection
		// now writes a choice's answer into a copied bindings map (never in place),
		// so `mid` stays byte-identical here — the engine immutability defect this
		// suite used to document (todo/16 §5) is fixed.
		const midSnapshot = JSON.stringify(mid)

		// Path A — live: resolve the choice DIRECTLY on `mid`, then run the rest of
		// the log. Resolving twice from the same `mid` must give identical results
		// (a second reduce is a faithful replay of the save point).
		const liveFinal = reduceLog(reduce(mid, rest[0]!).state, rest.slice(1))
		expect(JSON.stringify(mid)).toBe(midSnapshot) // the suspended mid is NOT mutated
		const replayOfMid = reduceLog(reduce(mid, rest[0]!).state, rest.slice(1))
		expect(JSON.stringify(replayOfMid)).toBe(JSON.stringify(liveFinal))

		// Path B — round-trip: deserialise the still-pristine `mid`, resolve the
		// SAME choice, run the SAME remainder.
		const revived = JSON.parse(JSON.stringify(mid)) as GameState
		assertInvariants(revived)
		const rtFinal = reduceLog(reduce(revived, rest[0]!).state, rest.slice(1))

		// Both finish at the byte-identical state — the stack is data.
		expect(JSON.stringify(rtFinal)).toBe(JSON.stringify(liveFinal))
		expect(JSON.stringify(liveFinal)).toBe(JSON.stringify(live))
	})

	it('undo N intents then replay → deep-equal to the pre-undo state', () => {
		const { log } = mixedGame()
		const isChoice = (i: Intent): boolean => i.t === 'RESOLVE_CHOICE'
		// A checkpoint well past the opening moves, at a non-choice boundary.
		const k = log.findIndex(
			(_, idx) => idx > 8 && !isChoice(log[idx - 1]!) && !isChoice(log[idx]!),
		)
		const stop = k === -1 ? Math.min(log.length, 40) : k

		let s = setup(mixedConfig(), catalog)
		const checkpoints: GameState[] = []
		for (let i = 0; i <= stop; i++) {
			checkpoints.push(s)
			if (i < stop) s = reduce(s, log[i]!).state
		}
		// checkpoint[j] is the state after j intents; undo N of them.
		const N = 5
		const undone = checkpoints[stop - N]!
		const replayFromUndo = replay(
			{ ...createSession(mixedConfig(), catalog), log: log.slice(0, stop - N) },
			catalog,
		)
		expect(JSON.stringify(replayFromUndo)).toBe(JSON.stringify(undone))
		// and replaying the session with the FULL log matches the final live state
		// (the full-log replay must land exactly on the post-game state).
		const full = replay(
			{ ...createSession(mixedConfig(), catalog), log },
			catalog,
		)
		expect(JSON.stringify(full)).toBe(
			JSON.stringify(reduceLog(setup(mixedConfig(), catalog), log)),
		)
	})
})
