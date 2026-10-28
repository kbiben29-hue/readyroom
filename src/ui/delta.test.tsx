// Token motion in the real app (jsdom has no Element.animate, so the flight
// layer degrades to badges only — exactly the reduced-motion path): a dispatch
// that moves tokens floats a delta on the counters, undo and passing the
// device never do, and the action tray shows every available and used action.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { SetupConfig } from '../engine/setup'
import type { GameState } from '../engine/state'
import type { ProjectedState } from './projection'
import App from './App'
import { useGameStore } from './store'
import { DELTA_WINDOW_MS } from './delta'

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

/** The first legal PLAY/ACTIVATE that spends an action (undoing any that
 *  does not — the hot-seat undo policy allows it within the turn). */
function playOneCard(): void {
	const tries = useGameStore
		.getState()
		.legal.filter((it) => it.t === 'PLAY_CARD' || it.t === 'ACTIVATE')
	for (const intent of tries) {
		act(() => {
			useGameStore.getState().dispatch(intent)
		})
		const s = useGameStore.getState().state!
		if (s.players[s.activeSeat].actions.spent === 1) return
		act(() => {
			useGameStore.getState().undo()
		})
	}
	throw new Error('no legal intent spends an action')
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
	act(() => {
		useGameStore.getState().loadCatalog()
		useGameStore.getState().startGame(config())
	})
})

afterEach(() => {
	vi.useRealTimers()
})

describe('token motion (jsdom)', () => {
	it('a dispatch that moves tokens floats a delta badge, then clears it', () => {
		vi.useFakeTimers()
		const host = renderApp()
		playOneCard()
		expect(useGameStore.getState().motion).not.toBeNull()
		const badges = host.querySelectorAll('.delta-badge')
		expect(badges.length).toBeGreaterThan(0)
		// the action paid for the card is announced on the tray
		const seat = useGameStore.getState().state!.activeSeat
		const tray = host.querySelector(`[data-anchor="player:${seat}:ACTION"]`)
		expect(tray?.querySelector('.delta-badge-down')?.textContent).toBe('−1')
		act(() => {
			vi.advanceTimersByTime(DELTA_WINDOW_MS + 50)
		})
		expect(host.querySelectorAll('.delta-badge')).toHaveLength(0)
	})

	it('the fresh log rows of the last step are highlighted', () => {
		const host = renderApp()
		playOneCard()
		// pin the log so the assertion does not depend on what the card logs
		act(() => {
			const p = useGameStore.getState().projected as unknown as GameState
			const log = [
				{ kind: 'INFO' as const, message: 'older' },
				{ kind: 'BENEFIT' as const, seat: 0 as const, message: 'just now' },
			]
			useGameStore.setState({
				projected: { ...p, log } as unknown as ProjectedState,
				motion: { ...useGameStore.getState().motion!, logFrom: 1 },
			})
		})
		const fresh = [...host.querySelectorAll('.log-fresh')]
		expect(fresh.map((r) => r.textContent)).toEqual([
			expect.stringContaining('just now'),
		])
	})

	it('undo and passing the device never animate', () => {
		vi.useFakeTimers()
		const host = renderApp()
		playOneCard()
		act(() => {
			vi.advanceTimersByTime(DELTA_WINDOW_MS + 50)
		})
		act(() => {
			useGameStore.getState().undo()
		})
		expect(useGameStore.getState().motion).toBeNull()
		expect(host.querySelectorAll('.delta-badge')).toHaveLength(0)
		act(() => {
			useGameStore.getState().setViewer(1)
		})
		expect(useGameStore.getState().motion).toBeNull()
		expect(host.querySelectorAll('.delta-badge')).toHaveLength(0)
	})

	it('the action tray shows every available action and each one used', () => {
		const host = renderApp()
		playOneCard()
		const seat = useGameStore.getState().state!.activeSeat
		const tray = () =>
			host.querySelector(`.topbar [data-anchor="player:${seat}:ACTION"]`)!
		const { available, spent } =
			useGameStore.getState().state!.players[seat].actions
		expect(spent).toBe(1)
		expect(tray().querySelectorAll('.tray-available')).toHaveLength(available)
		expect(tray().querySelectorAll('.tray-spent')).toHaveLength(1)

		// a gained 4th action is drawn, not capped at 3
		act(() => {
			const p = useGameStore.getState().projected as unknown as GameState
			const players = p.players.map((pl) =>
				pl.seat === seat ? { ...pl, actions: { available: 4, spent: 1 } } : pl,
			)
			useGameStore.setState({
				projected: { ...p, players } as unknown as ProjectedState,
			})
		})
		expect(tray().querySelectorAll('.tray-available')).toHaveLength(4)
		expect(tray().textContent).toContain('4 left')
	})
})
