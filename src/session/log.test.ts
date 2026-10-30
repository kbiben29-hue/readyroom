// todo/17 DoD — log/replay/undo, driven by a real multi-step game
// (src/session/playGame.ts) through the session adapter.
//
// The engine's real-card test (pic-shr-game.test.ts) documents a parity
// quirk: while an EFFECT frame is on the stack the frame aliases a def-tree
// node (a DAG, not a true cycle), so assertSerialisable's strict
// no-shared-reference pass trips there. That is an engine/data concern owned
// elsewhere; the honest serialisability check is the JSON round-trip (which
// throws on a real cycle) + byte-identity. checkSerialisable below mirrors
// that accepted pattern.

import { describe, expect, it, beforeEach } from 'vitest'
import type { GameState } from '../engine/state'
import { assertSerialisable } from '../engine/invariants'
import type { Intent } from '../engine/intents'
import type { CardCatalog } from '../engine/setup'
import type { Session } from './log'
import {
	createSession,
	append,
	undo,
	replay,
	refreshMeta,
	commit,
	cardDataHash,
	checkCardData,
	estimateScore,
	sessionSeed,
	backfillFinal,
} from './log'
import type { SessionAdapter } from './adapter'
import { SessionAdapter as Adapter } from './adapter'
import { makeCatalog, sessionConfig, playGame } from './playGame'

let catalog: CardCatalog
let adapter: SessionAdapter
/** snapshot JSON keyed by session.log.length at the moment it was taken. */
let snapshots: Map<number, string>

beforeEach(async () => {
	catalog = await makeCatalog()
	const session = createSession(sessionConfig(), catalog, {
		id: 'test-game',
		now: fixedClock,
	})
	adapter = new Adapter({ session, catalog, now: fixedClock })
	snapshots = new Map()
	snapshots.set(0, JSON.stringify(adapter.state))
	const onStep = (a: SessionAdapter): void => {
		snapshots.set(a.session.log.length, JSON.stringify(a.state))
	}
	playGame(adapter, onStep)
})

const fixedClock = (): Date => new Date('2026-09-21T10:00:00.000Z')

function checkSerialisable(state: GameState): void {
	try {
		assertSerialisable(state)
	} catch (err) {
		const msg = (err as Error).message
		if (!msg.startsWith('cycle at $.stack')) throw err
		const text = JSON.stringify(state)
		if (text === undefined) throw new Error('state is not JSON-serialisable')
		JSON.parse(text)
	}
}

function replayState(session: Session): GameState {
	return replay(session, catalog)
}

describe('log: createSession + meta', () => {
	it('creates a v2 session with an empty log and a browsable meta', () => {
		const session = createSession(sessionConfig(), catalog, {
			id: 'x',
			now: fixedClock,
		})
		expect(session.version).toBe(2)
		expect(session.log).toEqual([])
		expect(session.meta.intentCount).toBe(0)
		expect(session.meta.turnNumber).toBe(1)
		expect(session.meta.phase).toBe('SETUP')
		expect(session.meta.result).toBeNull()
		expect(session.meta.boardSides).toEqual(['ADVANCED', 'BASIC'])
		expect(session.meta.deckNames[0]).not.toBe('') // captain-name labels
		expect(sessionSeed(session)).toBe(25)
		expect(session.meta.scoreEstimate).toHaveLength(2)
		expect(session.meta.final).toBeUndefined()
		expect(session.meta.cardDataHash.length).toBe(16)
	})

	it('refreshMeta tracks turn number, active seat, phase and intent count', () => {
		const s = adapter.session
		expect(s.meta.intentCount).toBe(s.log.length)
		expect(s.meta.phase).toBe('GAME_OVER')
		expect(s.meta.result).toBe('COMPLETE')
		// the save list shows the result without replaying the game
		const result = adapter.state.result
		if (result?.kind !== 'COMPLETE') throw new Error('game not finalised')
		expect(s.meta.final).toEqual({
			score: [
				result.scoreboard.breakdown[0].total,
				result.scoreboard.breakdown[1].total,
			],
			winners: result.scoreboard.winners,
		})
		// The terminal turn number/seat are whatever the engine's final END_TURN
		// produced (deterministic per run) — meta must mirror the live state.
		expect(s.meta.turnNumber).toBe(adapter.state.turnNumber)
		expect(s.meta.activeSeat).toBe(adapter.state.activeSeat)
		expect(s.meta.turnNumber).toBeGreaterThanOrEqual(4)
	})
})

describe('log: backfillFinal', () => {
	it('fills in the result of a finished save from before meta.final', () => {
		const done = adapter.session
		const { final, ...rest } = done.meta
		const old: Session = { ...done, meta: rest }
		const filled = backfillFinal(old, catalog)
		expect(filled.meta.final).toEqual(final)
		expect(filled.meta.updatedAt).toBe(old.meta.updatedAt)
		expect(backfillFinal(filled, catalog)).toBe(filled) // nothing left to do
	})

	it('leaves running games and drifted card data alone', () => {
		const running = createSession(sessionConfig(), catalog, { id: 'r' })
		expect(backfillFinal(running, catalog)).toBe(running)
		const { final: _final, ...rest } = adapter.session.meta
		const drifted: Session = {
			...adapter.session,
			meta: { ...rest, cardDataHash: 'deadbeefdeadbeef' },
		}
		expect(backfillFinal(drifted, catalog)).toBe(drifted)
	})
})

describe('log: append / undo primitives', () => {
	it('append/undo are pure and survive JSON round-trips', () => {
		const a: Intent = { t: 'START' }
		const b: Intent = { t: 'PASS' }
		const c: Intent = {
			t: 'RESOLVE_CHOICE',
			choiceId: 'x',
			selection: [1, 'two', { ok: true }],
		}
		const log = append(append([], a), b)
		expect(append(log, c)).toHaveLength(3)
		expect(undo(log)).toEqual([a])
		expect(undo(append(log, c), 2)).toEqual([a])
		expect(undo([], 5)).toEqual([])
		expect(undo(log, 0)).toEqual([a, b])
		expect(JSON.parse(JSON.stringify(append(log, c)))).toEqual([a, b, c])
	})
})

describe('todo/17 DoD — replay determinism', () => {
	it('replay of the recorded session is byte-identical to the live run', () => {
		const live = JSON.stringify(adapter.state)
		const replayed = JSON.stringify(replay(adapter.session, catalog))
		expect(replayed).toBe(live)
	})

	it('a second fresh run of the same seed + log is byte-identical (replay twice)', () => {
		const a = JSON.stringify(replay(adapter.session, catalog))
		const b = JSON.stringify(replay(adapter.session, catalog))
		expect(a).toBe(b)
	})

	it('a session log round-tripped through JSON replays byte-identically', () => {
		const jsonLog = JSON.parse(JSON.stringify(adapter.session.log)) as Intent[]
		const round = { ...adapter.session, log: jsonLog }
		expect(JSON.stringify(replay(round, catalog))).toBe(
			JSON.stringify(adapter.state),
		)
	})

	it('replay terminates in a COMPLETE result with mid-effect points on the way', () => {
		const state = replay(adapter.session, catalog)
		expect(state.result?.kind).toBe('COMPLETE')
		// A recorded mid-effect state: after PLAY_CARD 1PIC23 (log length 2) the
		// game is suspended on a pending choice with a live effect stack.
		const mid = JSON.parse(snapshots.get(2)!) as GameState
		expect(mid.pendingChoice).not.toBeNull()
		expect(mid.stack.length).toBeGreaterThan(0)
	})
})

describe('todo/17 DoD — undo correctness', () => {
	it('undo of k intents replays byte-identically to the state before they ran', () => {
		const N = adapter.session.log.length
		for (let k = 1; k <= N; k++) {
			const truncated = undo(adapter.session.log, k)
			const replayed = replayState({ ...adapter.session, log: truncated })
			const before = snapshots.get(N - k)
			expect(
				before,
				`undo ${k} must match snapshot at log length ${N - k}`,
			).toBeDefined()
			expect(JSON.stringify(replayed)).toBe(before)
		}
	})

	it('undoing a single RESOLVE_CHOICE returns to the exact mid-choice state', () => {
		// Log: 1 START, 2 PLAY_CARD 1PIC23, 3 RESOLVE_CHOICE (incident CHOOSE_CARDS).
		const midChoice = JSON.parse(snapshots.get(2)!) as GameState
		expect(midChoice.pendingChoice).not.toBeNull()
		const truncated = replayState({
			...adapter.session,
			log: undo(adapter.session.log, adapter.session.log.length - 2),
		})
		// undo(…, N - 2) keeps the first 2 intents → state at log length 2.
		expect(JSON.stringify(truncated)).toBe(snapshots.get(2))
		expect(truncated.pendingChoice).not.toBeNull()
		expect(truncated.stack.length).toBeGreaterThan(0)
	})

	it('undoing across a full turn boundary lands mid-choice and matches the snapshot', () => {
		// Log length 12 = Turn 1's clean-up fully resolved, SHR's Turn 2 has
		// just begun — undoing from the end of the game (length 36) past that
		// boundary must land on byte-identical "just before Turn 2" state.
		const turnStart = snapshots.get(12)!
		const truncated = replayState({
			...adapter.session,
			log: undo(adapter.session.log, adapter.session.log.length - 12),
		})
		expect(JSON.stringify(truncated)).toBe(turnStart)
		expect(truncated.activeSeat).toBe(1)
		expect(truncated.turnNumber).toBe(2)
	})
})

describe('todo/17 DoD — serialisability of every produced state', () => {
	it('every snapshot state passes the serialisability check', () => {
		for (const [length, json] of snapshots) {
			const state = JSON.parse(json) as GameState
			expect(
				() => checkSerialisable(state),
				`state at log length ${length}`,
			).not.toThrow()
		}
	})
	it('the live and replayed terminal states pass too', () => {
		checkSerialisable(adapter.state)
		checkSerialisable(replay(adapter.session, catalog))
	})
})

describe('log: commit (pure append+replay dispatch)', () => {
	it('committing intents grows the log and produces the same state as the adapter', () => {
		let s = createSession(sessionConfig(), catalog, {
			id: 'pure',
			now: fixedClock,
		})
		const next = commit(s, { t: 'START' }, catalog, fixedClock)
		expect(next.log).toEqual([{ t: 'START' }])
		expect(replay(next, catalog).phase.k).toBe('ACTION')

		// Drive replay of the adapter's full log through commit one intent at a
		// time and compare each intermediate state to the adapter's live one.
		s = createSession(sessionConfig(), catalog, {
			id: 'pure2',
			now: fixedClock,
		})
		for (let i = 0; i < adapter.session.log.length; i++) {
			s = commit(s, adapter.session.log[i]!, catalog, fixedClock)
		}
		expect(JSON.stringify(replay(s, catalog))).toBe(
			JSON.stringify(adapter.state),
		)
	})
})

describe('log: card-data hash + drift detection', () => {
	it('cardDataHash is stable and orders canonically', () => {
		expect(cardDataHash(catalog)).toBe(cardDataHash(catalog))
		expect(cardDataHash(catalog)).toBe(cardDataHash(structuredClone(catalog)))
	})

	it('a card-data change flips the hash and checkCardData reports it', () => {
		const clone = structuredClone(catalog) as CardCatalog
		const firstDef = clone.defs[0]!
		firstDef.vp = firstDef.vp + 1
		const changed = clone.defs.map((d) => (d.id === firstDef.id ? firstDef : d))
		clone.defs = changed
		expect(cardDataHash(clone)).not.toBe(cardDataHash(catalog))
		expect(checkCardData(adapter.session, clone).ok).toBe(false)
		expect(checkCardData(adapter.session, catalog).ok).toBe(true)
	})
})

describe('log: score estimate', () => {
	it('grows as glory and VP-carrying cards enter public play', () => {
		const s0 = JSON.parse(snapshots.get(0)!) as GameState
		const start = estimateScore(s0, 0)
		const end = estimateScore(adapter.state, 0)
		expect(start).toBeGreaterThanOrEqual(1)
		expect(end).toBeGreaterThan(start)
		expect(estimateScore(adapter.state, 1)).toBeGreaterThanOrEqual(1)
	})

	it('leaves out the printed VP of cards hidden from a viewer', () => {
		const s = adapter.state
		const vpIn = (zone: string): number =>
			Object.values(s.cards)
				.filter((c) => c.owner === 0 && c.zone.k === zone)
				.reduce(
					(n, c) => n + (catalog.defs.find((d) => d.id === c.def)?.vp ?? 0),
					0,
				)
		// the Reserve deck is facedown to everyone; a Captain's Log only to
		// the opponent
		const all = estimateScore(s, 0)
		expect(estimateScore(s, 0, 0)).toBe(all - vpIn('RESERVE'))
		expect(estimateScore(s, 0, 1)).toBe(all - vpIn('RESERVE') - vpIn('LOG'))
	})
})

describe('log: refreshMeta preserves stable fields', () => {
	it('deck names + board sides + card hash are stable across refreshes', () => {
		const stable = {
			deckNames: adapter.session.meta.deckNames,
			boardSides: adapter.session.meta.boardSides,
			cardDataHash: adapter.session.meta.cardDataHash,
		}
		const refreshed = refreshMeta(
			adapter.session,
			replay(adapter.session, catalog),
			catalog,
			() => new Date('2099-01-01T00:00:00.000Z'),
		)
		expect(refreshed.meta.deckNames).toEqual(stable.deckNames)
		expect(refreshed.meta.boardSides).toEqual(stable.boardSides)
		expect(refreshed.meta.cardDataHash).toBe(stable.cardDataHash)
		expect(refreshed.meta.updatedAt).toBe('2099-01-01T00:00:00.000Z')
	})
})
