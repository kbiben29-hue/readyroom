// The console laid out across the table (docs/ui-lcars.md §4): the opponent
// band, the decks on the table, the hand dock, and the layers that open only
// on request — the viewscreen (V), the log drawer (L), the menu.

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { SetupConfig } from '../../engine/setup'
import { zoneKey } from '../../engine/state'
import App from '../App'
import { useGameStore } from '../store'
import { useConsoleUi } from './consoleUi'
import { HOLD_MS } from './longPress'

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

// unmounted between tests: a live root keeps its window shortcuts
const roots: Root[] = []

function renderGame(): HTMLElement {
	act(() => {
		useGameStore.getState().loadCatalog()
		useGameStore.getState().startGame(config())
	})
	const host = document.createElement('div')
	document.body.appendChild(host)
	const root = createRoot(host)
	roots.push(root)
	act(() => {
		root.render(<App />)
	})
	return host
}

function key(k: string, init: KeyboardEventInit = {}, target?: Element) {
	act(() => {
		;(target ?? window).dispatchEvent(
			new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }),
		)
	})
}

beforeEach(() => {
	act(() => {
		for (const root of roots.splice(0)) root.unmount()
	})
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
	useConsoleUi.getState().reset(0)
})

describe('console across the table', () => {
	it('the opponent band holds their hand face down, their decks and their pool', () => {
		const host = renderGame()
		const band = host.querySelector('.opp-band')!
		const real = useGameStore.getState().state!
		const hand = real.zones[zoneKey({ k: 'HAND', seat: 1 })] ?? []
		expect(hand.length).toBeGreaterThan(0)
		// one back per card, and not one face among them
		expect(band.querySelectorAll('.opp-hand .card')).toHaveLength(hand.length)
		expect(band.querySelectorAll('.opp-hand .card-hidden')).toHaveLength(
			hand.length,
		)
		// their Draw and Discard as decks
		expect(band.querySelector('[aria-label^="Draw ("]')).not.toBeNull()
		expect(band.querySelector('[aria-label^="Discard ("]')).not.toBeNull()
		// one counter per pool: theirs in the band, yours in the head bar
		for (const seat of [0, 1])
			expect(
				host.querySelectorAll(`[data-anchor="player:${seat}:DIL"]`),
			).toHaveLength(1)
		expect(band.querySelector('[data-anchor="player:1:DIL"]')).not.toBeNull()
		expect(
			host.querySelector('.topbar [data-anchor="player:0:DIL"]'),
		).not.toBeNull()
		// their Captain is on the table, small
		expect(band.querySelector('.band-captain .card')).not.toBeNull()
	})

	it('the shared piles are decks in the centre, the Stardate counter once', () => {
		const host = renderGame()
		const piles = host.querySelector('.centre-piles')!
		expect(piles.querySelector('[aria-label^="Stardates ("]')).not.toBeNull()
		expect(piles.querySelector('[aria-label^="Incidents ("]')).not.toBeNull()
		expect(piles.querySelector('[aria-label^="Junk ("]')).not.toBeNull()
		expect(host.querySelectorAll('[data-anchor="stardate"]')).toHaveLength(1)
		// your own Draw and Discard sit in the hand dock
		const dock = host.querySelector('.hand-dock')!
		expect(dock.querySelector('[aria-label^="Draw ("]')).not.toBeNull()
		expect(dock.querySelector('[aria-label^="Discard ("]')).not.toBeNull()
	})

	it('V puts the opponent on screen, without a Complete button, and Esc takes it off', () => {
		const host = renderGame()
		expect(host.querySelector('.viewscreen')).toBeNull()
		key('v')
		const screen = host.querySelector('.viewscreen')!
		expect(screen).not.toBeNull()
		expect(screen.querySelector('[aria-label="Player 2 area"]')).not.toBeNull()
		expect(
			screen.querySelector('[aria-label="Player 2 crew board"]'),
		).not.toBeNull()
		expect(
			[...screen.querySelectorAll('button')].some(
				(b) => b.textContent === 'Complete',
			),
		).toBe(false)
		key('Escape')
		expect(host.querySelector('.viewscreen')).toBeNull()
		// a click on the band's background opens it too
		act(() => {
			;(host.querySelector('.band-tableau') as HTMLElement).click()
		})
		expect(host.querySelector('.viewscreen')).not.toBeNull()
	})

	it('the log opens only on request, and Esc closes the top layer first', () => {
		const host = renderGame()
		expect(host.querySelector('.log-drawer')).toBeNull()
		const play = useGameStore
			.getState()
			.legal.find((it) => it.t === 'PLAY_CARD' || it.t === 'ACTIVATE')
		if (play !== undefined)
			act(() => {
				useGameStore.getState().dispatch(play)
			})
		expect(host.querySelector('.log-drawer')).toBeNull()
		key('l')
		expect(
			host.querySelector('.log-drawer [aria-label="Game log"]'),
		).not.toBeNull()
		key('v')
		// the viewscreen opened last, so Esc closes it and leaves the log
		key('Escape')
		expect(host.querySelector('.viewscreen')).toBeNull()
		expect(host.querySelector('.log-drawer')).not.toBeNull()
		key('Escape')
		expect(host.querySelector('.log-drawer')).toBeNull()
	})

	it('shortcuts ignore modifiers, auto-repeat and typing in a field', () => {
		const host = renderGame()
		key('l', { metaKey: true })
		key('l', { altKey: true })
		key('l', { repeat: true })
		expect(host.querySelector('.log-drawer')).toBeNull()
		const input = document.createElement('input')
		document.body.appendChild(input)
		key('l', {}, input)
		expect(host.querySelector('.log-drawer')).toBeNull()
		key('L')
		expect(host.querySelector('.log-drawer')).not.toBeNull()
	})

	it('H pins the hand dock up and lets it drop again', () => {
		const host = renderGame()
		const dock = () => host.querySelector('.hand-dock')!
		expect(dock().classList.contains('dock-raised')).toBe(false)
		key('h')
		expect(dock().classList.contains('dock-raised')).toBe(true)
		expect(dock().classList.contains('dock-pinned')).toBe(true)
		key('h')
		expect(dock().classList.contains('dock-raised')).toBe(false)
		// the hand is in it, at full size
		const hand =
			useGameStore.getState().state!.zones[zoneKey({ k: 'HAND', seat: 0 })]!
		expect(dock().querySelectorAll('.dock-fan .card-hand')).toHaveLength(
			hand.length,
		)
	})

	it('a touch tap on the lowered hand lifts it instead of opening a card', () => {
		const host = renderGame()
		const dock = host.querySelector('.hand-dock')!
		const card = dock.querySelector('.dock-fan .card-inner') as HTMLElement
		act(() => {
			card.dispatchEvent(
				new PointerEvent('pointerdown', {
					bubbles: true,
					pointerType: 'touch',
				}),
			)
			card.click()
		})
		expect(dock.classList.contains('dock-raised')).toBe(true)
		expect(useGameStore.getState().detailIid).toBeNull()
	})

	it('Undo stays in the head bar; the rest sits in the menu', () => {
		const host = renderGame()
		const buttons = () =>
			[...host.querySelectorAll('button')].map((b) => b.textContent?.trim())
		expect(buttons()).toContain('Undo')
		expect(buttons()).not.toContain('Replay')
		act(() => {
			;[...host.querySelectorAll('button')]
				.find((b) => b.textContent?.trim() === 'Menu')!
				.click()
		})
		expect(buttons()).toEqual(
			expect.arrayContaining(['Replay', 'Reference', 'Settings', 'New game']),
		)
		key('Escape')
		expect(buttons()).not.toContain('Replay')
		// no fullscreen API in jsdom: no button for it
		expect(host.querySelector('[aria-label="Fullscreen"]')).toBeNull()
	})

	it('a long press zooms a card until the finger lifts, and swallows the tap', () => {
		vi.useFakeTimers()
		try {
			const host = renderGame()
			const card = host.querySelector('.own-row .card') as HTMLElement
			const touch = (type: string) =>
				act(() => {
					card.dispatchEvent(
						new PointerEvent(type, {
							bubbles: true,
							pointerType: 'touch',
							clientX: 20,
							clientY: 20,
						}),
					)
				})
			touch('pointerdown')
			act(() => {
				vi.advanceTimersByTime(HOLD_MS + 20)
			})
			expect(document.querySelector('.zoom-layer')).not.toBeNull()
			touch('pointerup')
			expect(document.querySelector('.zoom-layer')).toBeNull()
			act(() => {
				;(card.querySelector('.card-inner') as HTMLElement).click()
			})
			expect(useGameStore.getState().detailIid).toBeNull()
		} finally {
			vi.useRealTimers()
		}
	})

	it('F asks for fullscreen where the browser offers it', () => {
		const request = vi.fn(() => Promise.resolve())
		Object.defineProperty(document, 'fullscreenEnabled', {
			configurable: true,
			value: true,
		})
		document.documentElement.requestFullscreen = request
		try {
			const host = renderGame()
			expect(host.querySelector('[aria-label="Fullscreen"]')).not.toBeNull()
			key('f')
			expect(request).toHaveBeenCalledTimes(1)
		} finally {
			Object.defineProperty(document, 'fullscreenEnabled', {
				configurable: true,
				value: undefined,
			})
		}
	})
})
