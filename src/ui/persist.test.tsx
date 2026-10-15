// Store-level persistence tests (todo/17 §1/§3 — the "survives a refresh"
// Definition of Done). A session is the intent log + setup + seed; loading
// replays it, so:
//   - startGame persists a browseable save immediately (load screen sees it);
//   - autosave after an intent is debounced ~1 s;
//   - a refresh mid-PendingChoice resumes to a byte-identical state;
//   - export → import → resume is identical (the bug-report format).
//
// The adapter's autosave schedules the debounce with setTimeout, so the two
// debounce tests install fake timers BEFORE the first dispatch (a timer
// scheduled under the real clock is invisible to advanceTimersByTime).

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import type { SetupConfig } from '../engine/setup'
import { createSession } from '../session/log'
import { SessionAdapter } from '../session/adapter'
import { useGameStore } from './store'
import {
	exportSession,
	importSession,
	getSessionStore,
	resetSessionStoreForTests,
	readSessionFile,
} from './persistence'
import { loadBrowserCatalog } from './browserCatalog'

const catalog = loadBrowserCatalog()

function config(): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: 'PIC', boardSide: 'ADVANCED' },
			{ deck: 'SHR', boardSide: 'BASIC' },
		],
		seed: 25,
	}
}

/** Drive to the first PendingChoice (turn 1: 1PIC23's "discard an incident"
 *  CHOOSE_CARDS) — deterministic under the real catalog (seed 25). */
function reachPendingChoice(): SessionAdapter {
	const adapter = new SessionAdapter({
		session: createSession(config(), catalog, { id: 'choice-probe' }),
		catalog,
	})
	adapter.dispatch({ t: 'START' })
	const hand = adapter.state.zones['HAND:0'] ?? []
	const pic23 = hand.find(
		(iid) => adapter.state.cards[iid]?.def === '1PIC23-24',
	)
	if (pic23 === undefined)
		throw new Error('opening hand missing 1PIC23-24 — catalog drift?')
	adapter.dispatch({ t: 'PLAY_CARD', iid: pic23, operationIndex: 0 })
	return adapter
}

beforeEach(() => {
	document.body.innerHTML = ''
	resetSessionStoreForTests()
	useGameStore.getState().newGame()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('autosave (todo/17 §1)', () => {
	it('startGame persists a browseable save immediately', async () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().startGame(config())
		})
		const saves = await getSessionStore().list()
		expect(saves).toHaveLength(1)
		const s = saves[0]!
		expect(s.log).toHaveLength(0)
		expect(s.meta.deckNames).toHaveLength(2)
		expect(s.meta.boardSides).toEqual(['ADVANCED', 'BASIC'])
		expect(typeof s.meta.cardDataHash).toBe('string')
	})

	it('autosaves after an intent, debounced (~1 s), without an explicit save call', async () => {
		vi.useFakeTimers()
		try {
			act(() => {
				useGameStore.getState().loadCatalog()
				useGameStore.getState().startGame(config())
			})
			act(() => useGameStore.getState().dispatch({ t: 'START' }))

			// Debounce: immediately after the intent, the stored save is still the
			// pre-intent one.
			expect((await getSessionStore().list())[0]!.log).toHaveLength(0)

			await act(async () => {
				vi.advanceTimersByTime(1100)
				await Promise.resolve()
				await Promise.resolve()
			})

			const saves = await getSessionStore().list()
			expect(saves).toHaveLength(1)
			expect(saves[0]!.log).toEqual([{ t: 'START' }])
			expect(saves[0]!.meta.intentCount).toBe(1)
		} finally {
			vi.useRealTimers()
		}
	})
})

describe('refresh mid-game (Definition of Done)', () => {
	it('survives a refresh mid-PendingChoice: resume replays to an identical state', async () => {
		vi.useFakeTimers()
		try {
			act(() => {
				useGameStore.getState().loadCatalog()
				useGameStore.getState().startGame(config())
			})
			act(() => useGameStore.getState().dispatch({ t: 'START' }))
			const hand0 = useGameStore.getState().state!.zones['HAND:0'] ?? []
			const pic23 = hand0.find(
				(iid) => useGameStore.getState().state!.cards[iid]?.def === '1PIC23-24',
			)
			if (pic23 !== undefined) {
				act(() =>
					useGameStore
						.getState()
						.dispatch({ t: 'PLAY_CARD', iid: pic23, operationIndex: 0 }),
				)
			}
			expect(useGameStore.getState().pendingChoice).not.toBeNull()

			// Let the debounced autosave land — the stored save is now the
			// mid-choice session (log = [START, PLAY_CARD]).
			await act(async () => {
				vi.advanceTimersByTime(1200)
				await Promise.resolve()
				await Promise.resolve()
			})
			const saved = (await getSessionStore().list())[0]!
			expect(saved.log).toHaveLength(2)

			const captured = JSON.stringify(useGameStore.getState().state)

			// "Refresh": tear the whole thing down, then resume from the saved
			// session — the exact path a page reload takes.
			act(() => useGameStore.getState().newGame())
			expect(useGameStore.getState().state).toBeNull()
			act(() => useGameStore.getState().resumeGame(saved))

			const resumed = useGameStore.getState()
			expect(resumed.state).not.toBeNull()
			expect(resumed.pendingChoice).not.toBeNull()
			expect(JSON.stringify(resumed.state)).toBe(captured)
			expect(resumed.warning).toBeNull()
		} finally {
			vi.useRealTimers()
		}
	})
})

describe('export / import (todo/17 §3)', () => {
	it('exports to JSON and re-imports to an identical session + state', () => {
		const adapter = reachPendingChoice()
		const json = exportSession(adapter.session)

		const imported = importSession(json)
		expect(imported.id).toBe(adapter.session.id)
		expect(imported.setup).toEqual(adapter.session.setup)
		expect(imported.log).toEqual(adapter.session.log)

		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().resumeGame(imported)
		})
		expect(JSON.stringify(useGameStore.getState().state)).toBe(
			JSON.stringify(adapter.state),
		)
		expect(useGameStore.getState().pendingChoice).not.toBeNull()
	})

	it('rejects malformed / foreign-version import text', () => {
		expect(() => importSession('not JSON at all')).toThrow('not valid JSON')
		expect(() =>
			importSession('{"version":99,"id":"x","setup":{},"log":[]}'),
		).toThrow(/unsupported or malformed/)
	})

	it('readSessionFile parses a picked .json file back into a session', async () => {
		const session = createSession(config(), catalog, { id: 'file-bearer' })
		const file = new File([exportSession(session)], 'game.session.json', {
			type: 'application/json',
		})
		const parsed = await readSessionFile(file)
		expect(parsed.id).toBe('file-bearer')
		expect(parsed.log).toEqual(session.log)
	})
})
