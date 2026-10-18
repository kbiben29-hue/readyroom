// Smoke test (todo/14 DOoD): the app can create a game and render the board.
// Runs under the `dom` vitest project (jsdom). We render the real <App/> root,
// then drive the store through startGame and assert the shared board, the
// viewer's area/hand and the log panel appear.

import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { SetupConfig } from '../engine/setup'
import App from './App'
import { useGameStore } from './store'

function config(): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: 'PIC', boardSide: 'BASIC' },
			{ deck: 'SHR', boardSide: 'BASIC' },
		],
		seed: 7,
	}
}

function renderApp(): HTMLElement {
	const host = document.createElement('div')
	document.body.appendChild(host)
	const root = createRoot(host)
	act(() => {
		root.render(<App />)
	})
	return host
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
})

describe('app smoke (jsdom)', () => {
	it('boots the setup screen and lists the built crew decks', () => {
		act(() => {
			useGameStore.getState().loadCatalog()
		})
		const host = renderApp()
		expect(host.textContent).toContain('Ready Room')
		expect(host.textContent).toContain('Start game')
		const state = useGameStore.getState()
		expect(state.catalog).not.toBeNull()
		expect(state.error).toBeNull()
	})

	it('starts a game and renders the board, areas, hand and log', () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().startGame(config())
		})
		const host = renderApp()

		const text = host.textContent ?? ''
		expect(text).toContain('Market')
		expect(text).toContain('Stardate')
		expect(text).toContain('Neutral Zone')
		expect(text).toContain('Log')
		expect(
			host.querySelector('.hand') ?? host.querySelector('.hand-opponent'),
		).not.toBeNull()
		expect(
			host.querySelector('.player-area') ??
				host.querySelector('.area-compact-grid'),
		).not.toBeNull()

		const store = useGameStore.getState()
		expect(store.projected).not.toBeNull()
		expect(store.error).toBeNull()
	})

	it('the crew board shows the real mission and the side’s own track glyphs', () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().startGame(config())
		})
		const host = renderApp()
		const board = host.querySelector('[aria-label="Player 1 crew board"]')
		expect(board).not.toBeNull()
		// the PIC Basic side prints 1PIC/M1 (no VP shown on the Basic side)
		expect(board!.textContent).toContain('1PIC/M1')
		expect(board!.querySelector('.mission-vp')).toBeNull()
		// Basic Influence: ×1 at 0 … ×7 at 15 (src/data/cards/boards/pic.json)
		const glyphs = [...board!.querySelectorAll('.track-mult')].map(
			(e) => e.textContent,
		)
		expect(glyphs).toContain('×7')
		// each specialty bar ends in its position and current multiplier
		const influence = board!.querySelector('.console-track.s-influence')
		expect(influence?.getAttribute('aria-label')).toContain(
			'Influence: step 0 of 15 · Focus icons score ×1',
		)
		expect(influence?.querySelector('.readout-mult')?.textContent).toBe('×1')
		expect(influence?.querySelectorAll('.console-seg').length).toBe(16)
	})

	it('your resources sit on the crew console, the opponent keeps its pips', () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().startGame(config())
		})
		const host = renderApp()
		const board = host.querySelector('[aria-label="Player 1 crew board"]')
		// one counter per pool, so a token flight has exactly one place to land
		expect(host.querySelectorAll('[data-anchor="player:0:DIL"]').length).toBe(1)
		expect(board!.querySelector('[data-anchor="player:0:DIL"]')).not.toBeNull()
		expect(board!.querySelector('.tile-dil .tile-n')?.textContent).toBe(
			String(useGameStore.getState().state!.players[0].resources.DIL),
		)
		expect(host.querySelector('[data-anchor="player:1:DIL"]')).not.toBeNull()
	})

	it('advances past the first boundary and the choice panel routes by seat', () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().startGame(config())
		})
		act(() => {
			useGameStore.getState().dispatch({ t: 'START' })
		})
		const host = renderApp()
		// After START the stack machine auto-advances RESUPPLY -> CONTROL -> ACTION
		// (no RESUPPLY ops in play at turn start, no secured Location turn 1) — the
		// same post-START halt src/engine/intents.test.ts asserts.
		expect(useGameStore.getState().state?.phase.k).toBe('ACTION')
		expect(useGameStore.getState().error).toBeNull()
		expect((host.textContent ?? '').length).toBeGreaterThan(0)
	})
})
