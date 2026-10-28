// Store-level undo tests (todo/17 §2). The adapter's undo is byte-exact
// truncate + replay; these prove the UI-layer behaviour:
//   - solo (CADET) undoes freely, even across a full turn boundary, and the
//     result is byte-identical to never having played those intents;
//   - hot-seat (TWO_PLAYER) take-backs stop at a turn boundary (START/PASS/
//     END_TURN), but the active player may still undo their own move and get
//     the identical never-played state;
//   - the undoPolicy helper labels the exact rule the button enforces.
//
// Settling a turn's END_TURN leaves a CLEANUP pending choice (the market refill
// in this engine), so reaching the next turn requires resolving it — the helper
// below mirrors the canonical script in src/session/playGame.ts.

import { describe, expect, it, beforeEach } from 'vitest'
import { act } from 'react'
import type { SetupConfig } from '../engine/setup'
import { toIid } from '../engine/ids'
import { createSession, type Session } from '../session/log'
import { useGameStore, undoPolicy } from './store'
import { loadBrowserCatalog } from './browserCatalog'

const catalog = loadBrowserCatalog()

function config(mode: 'TWO_PLAYER' | 'CADET', seed = 25): SetupConfig {
	return {
		mode,
		players: [
			{ deck: 'PIC', boardSide: 'ADVANCED' },
			{ deck: 'SHR', boardSide: 'BASIC' },
		],
		seed,
	}
}

/** Resolve pending cleanup choices until the next turn's ACTION phase. */
function settleChain(): void {
	let guard = 0
	while (useGameStore.getState().pendingChoice !== null && guard++ < 10) {
		const s = useGameStore.getState()
		const choice = s.pendingChoice!
		let selection: unknown
		if (choice.k === 'CHOOSE_CARDS') {
			const ally = (s.state!.zones['MARKET_OFFER:ALLY'] ?? [])[0]
			selection =
				ally !== undefined && choice.candidates.includes(ally)
					? [ally]
					: choice.candidates.slice(0, choice.min)
		} else if (choice.k === 'CONFIRM') {
			selection = true
		} else {
			selection = []
		}
		s.settle(selection)
	}
	if (useGameStore.getState().error !== null) {
		throw new Error(`settleChain failed: ${useGameStore.getState().error}`)
	}
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
})

describe('undoPolicy (stated rule)', () => {
	it('solo is free; hot-seat stops at a turn boundary but allows own moves', () => {
		const session = createSession(config('TWO_PLAYER'), catalog, {
			id: 'u',
			now: () => new Date(0),
		})

		// empty log — nothing to undo
		expect(undoPolicy(session).allowed).toBe(false)

		// hot-seat: a turn-boundary intent (END_TURN / PASS / START) is not undoable
		const hsBoundary: Session = { ...session, log: [{ t: 'END_TURN' }] }
		expect(undoPolicy(hsBoundary).allowed).toBe(false)
		const hsPass: Session = { ...session, log: [{ t: 'PASS' }] }
		expect(undoPolicy(hsPass).allowed).toBe(false)

		// hot-seat: the player's own non-boundary move is undoable
		const hsMove: Session = {
			...session,
			log: [{ t: 'PLAY_CARD', iid: toIid('c'), operationIndex: 0 }],
		}
		expect(undoPolicy(hsMove).allowed).toBe(true)

		// solo (CADET): the same boundary intent is freely undoable
		const solo: Session = {
			...session,
			setup: { ...session.setup, mode: 'CADET' },
			log: [{ t: 'END_TURN' }],
		}
		expect(undoPolicy(solo).allowed).toBe(true)
	})
})

describe('undo across a full turn boundary', () => {
	it('solo (CADET): undoing a completed turn reproduces the pre-turn state byte-for-byte', () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().startGame(config('CADET'))
		})

		// Turn 1: START (taken by startGame) -> (auto-advance to ACTION) ->
		// END_TURN -> resolve the cleanup refill -> turn 2 begins (CADET keeps
		// seat 0 active).
		act(() => useGameStore.getState().dispatch({ t: 'END_TURN' }))
		act(() => settleChain())

		// Baseline: turn 2 ACTION — "we never played turn 2's intents".
		expect(useGameStore.getState().state?.turnNumber).toBe(2)
		const baseline = JSON.stringify(useGameStore.getState().state)

		// Play turn 2's only intent (the END_TURN boundary) -> CLEANUP pending.
		act(() => useGameStore.getState().dispatch({ t: 'END_TURN' }))
		expect(useGameStore.getState().pendingChoice).not.toBeNull()
		expect(JSON.stringify(useGameStore.getState().state)).not.toBe(baseline)

		// Undo across the whole turn boundary: turn 2's END_TURN never happened.
		act(() => useGameStore.getState().undo())
		expect(useGameStore.getState().pendingChoice).toBeNull()
		expect(useGameStore.getState().state?.turnNumber).toBe(2)
		expect(JSON.stringify(useGameStore.getState().state)).toBe(baseline)
		expect(useGameStore.getState().error).toBeNull()
	})

	it('hot-seat: refuses to undo past a turn boundary, and reports why', () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().startGame(config('TWO_PLAYER'))
		})
		// startGame takes the START boundary — not undoable, even in the act of
		// starting.
		expect(useGameStore.getState().session?.log).toEqual([{ t: 'START' }])
		expect(useGameStore.getState().canUndo).toBe(false)
		const before = JSON.stringify(useGameStore.getState().state)
		act(() => useGameStore.getState().undo())
		expect(JSON.stringify(useGameStore.getState().state)).toBe(before)
		expect(useGameStore.getState().warning).not.toBeNull()

		act(() => useGameStore.getState().clearWarning())
		act(() => useGameStore.getState().dispatch({ t: 'END_TURN' }))
		expect(useGameStore.getState().canUndo).toBe(false)
	})

	it('hot-seat: undoing your own in-turn move reproduces the never-moved state', () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().startGame(config('TWO_PLAYER'))
		})

		const hand0 = useGameStore.getState().state!.zones['HAND:0'] ?? []
		const pic23 = hand0.find(
			(iid) => useGameStore.getState().state!.cards[iid]?.def === '1PIC23-24',
		)
		if (pic23 === undefined)
			throw new Error('opening hand missing 1PIC23-24 — catalog drift?')

		const before = JSON.stringify(useGameStore.getState().state)
		act(() =>
			useGameStore
				.getState()
				.dispatch({ t: 'PLAY_CARD', iid: pic23, operationIndex: 0 }),
		)
		expect(useGameStore.getState().pendingChoice).not.toBeNull()
		expect(useGameStore.getState().canUndo).toBe(true) // own move within own turn

		act(() => useGameStore.getState().undo())
		expect(JSON.stringify(useGameStore.getState().state)).toBe(before)
		expect(useGameStore.getState().pendingChoice).toBeNull()
		expect(useGameStore.getState().error).toBeNull()
	})
})
