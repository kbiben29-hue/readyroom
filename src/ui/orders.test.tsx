// The desktop Orders drawer lists every legal PLAY / ACTIVATE /
// COMPLETE_MISSION intent of the viewer — one runnable row each — and a row's
// button dispatches exactly that intent.

import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { createSession } from '../session/log'
import { SessionAdapter } from '../session/adapter'
import { loadBrowserCatalog } from './browserCatalog'
import { useGameStore } from './store'
import { OrdersPanel } from './OrdersPanel'
import { orderCount } from './mobile/facts'

function startedSession() {
	const catalog = loadBrowserCatalog()
	const adapter = new SessionAdapter({
		session: createSession(
			{
				mode: 'TWO_PLAYER' as const,
				players: [
					{ deck: 'PIC', boardSide: 'ADVANCED' },
					{ deck: 'SHR', boardSide: 'BASIC' },
				],
				seed: 25,
			},
			catalog,
		),
		catalog,
	})
	adapter.dispatch({ t: 'START' })
	expect(adapter.state.phase.k).toBe('ACTION')
	return adapter.session
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
})

describe('Orders drawer', () => {
	it('lists one runnable row per legal move and runs the one clicked', () => {
		act(() => {
			useGameStore.getState().resumeGame(startedSession())
		})
		const legal = useGameStore.getState().legal
		const n = orderCount(legal)
		expect(n).toBeGreaterThan(0)

		let closed = 0
		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		act(() => {
			root.render(<OrdersPanel onClose={() => closed++} />)
		})
		const drawer = document.body.querySelector(
			'[aria-label="Orders: every legal move"]',
		)
		expect(drawer?.textContent).toContain(`Orders · ${n}`)
		const runs = [...document.body.querySelectorAll('button.op-activate')]
		expect(runs).toHaveLength(n)

		const logBefore = useGameStore.getState().session!.log.length
		const first = legal.find(
			(it) => it.t === 'PLAY_CARD' || it.t === 'ACTIVATE',
		)!
		act(() => {
			;(runs[0] as HTMLButtonElement).click()
		})
		// an idle operation asks first; confirm it
		if (useGameStore.getState().session!.log.length === logBefore)
			act(() => {
				;(runs[0] as HTMLButtonElement).click()
			})
		expect(closed).toBe(1)
		const log = useGameStore.getState().session!.log
		expect(log.length).toBeGreaterThan(logBefore)
		expect(log[logBefore]).toMatchObject(first)
		act(() => root.unmount())
	})

	it('shows an empty state when there is nothing to order', () => {
		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		act(() => {
			root.render(<OrdersPanel onClose={() => {}} />)
		})
		expect(document.body.querySelector('.orders-empty')).not.toBeNull()
		expect(document.body.querySelectorAll('button.op-activate')).toHaveLength(0)
		act(() => root.unmount())
	})
})
