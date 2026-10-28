// A legal operation that would do nothing (idleOperationReason) is flagged in
// the console card detail and needs a second click; a runnable operation's
// whole block is the control. Real catalog, real <App/>.

import { beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { SetupConfig } from '../engine/setup'
import App from './App'
import { setDetail, useGameStore } from './store'

// seed 4: 1SIS25-25 is in the opening hand, and no SHIP has warped anywhere,
// so its "send an Away Team where you have a SHIP" PLAY has no target
const config: SetupConfig = {
	mode: 'TWO_PLAYER',
	players: [
		{ deck: 'SIS', boardSide: 'BASIC' },
		{ deck: 'PIC', boardSide: 'BASIC' },
	],
	seed: 4,
	startingSeat: 0,
}

function renderApp(): HTMLElement {
	const host = document.createElement('div')
	document.body.appendChild(host)
	act(() => createRoot(host).render(<App />))
	return host
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
})

describe('an operation that would do nothing', () => {
	it('warns, asks "Are you sure?", and plays on the second click', () => {
		act(() => {
			useGameStore.getState().loadCatalog()
			useGameStore.getState().startGame(config)
		})
		const st = () => useGameStore.getState().state!
		const rio = Object.values(st().cards).find((c) => c.def === '1SIS25-25')!
		expect(rio.zone.k).toBe('HAND')
		const host = renderApp()
		act(() => setDetail(rio.iid))
		const blocks = host.querySelectorAll<HTMLElement>('.op-detail')
		const idle = blocks[2]!
		expect(idle.textContent).toContain('Does nothing right now')
		// the other PLAYs do something: no warning
		expect(blocks[0]!.textContent).not.toContain('Does nothing right now')
		const button = idle.querySelector<HTMLButtonElement>('button.op-activate')!
		expect(button.textContent).toBe('Play')
		expect(button.className).not.toContain('btn-warn')
		// a click anywhere on the block asks first
		act(() => idle.querySelector<HTMLElement>('.op-text')!.click())
		expect(button.textContent).toBe('Are you sure?')
		expect(st().cards[rio.iid]!.zone.k).toBe('HAND')
		act(() => idle.click())
		expect(st().cards[rio.iid]!.zone.k).not.toBe('HAND')
		expect(st().log.some((e) => e.kind === 'SKIPPED')).toBe(true)
	})
})
