// Regression test for the deployed-card ACTIVATION affordance: clicking a
// deployed card opens the detail overlay (cardClicked), and the overlay shows
// an Activate button for a currently-legal ACTIVATION which dispatches
// { t: 'ACTIVATE', ... } and exhausts the card. Drives the real session to a
// deployed activatable card (mirrors the opening moves of
// src/session/playGame.ts), then resumes that session into the UI store so the
// wiring is exercised end to end under jsdom.

import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { CardCatalog } from '../engine/setup'
import type { CardInstanceId } from '../engine/ids'
import type { GameState } from '../engine/state'
import { createSession, type Session } from '../session/log'
import { SessionAdapter } from '../session/adapter'
import { loadBrowserCatalog } from './browserCatalog'
import { useGameStore } from './store'
import { CardDetailHost, CardZoom } from './cards'
import { Hand } from './board'
import { canPlay } from '../engine/queries/legality'

let catalog: CardCatalog

/** Same two-deck fixture the session walkthrough drives (see sessionConfig in
 *  src/session/playGame.ts — imported here inline to keep node:fs out of the
 *  jsdom project). */
function uiConfig(): Parameters<typeof createSession>[0] {
	return {
		mode: 'TWO_PLAYER' as const,
		players: [
			{ deck: 'PIC', boardSide: 'ADVANCED' },
			{ deck: 'SHR', boardSide: 'BASIC' },
		],
		seed: 25,
	}
}

const zoneIids = (s: GameState, key: string): CardInstanceId[] =>
	s.zones[key] ?? []
const findDef = (s: GameState, key: string, def: string): CardInstanceId => {
	const iid = zoneIids(s, key).find((i) => s.cards[i]!.def === def)
	if (iid === undefined) throw new Error(`test fixture: ${def} not in ${key}`)
	return iid
}

/** Drive the opening of a PIC-vs-SHR game to the point where a deployed
 *  card (the Enterprise, 1PIC02) has a legal ACTIVATION — exactly the step
 *  before playGame's first ACTIVATE. Returns the finished session. */
function sessionWithActivatableDeployedCard(): Session {
	const adapter = new SessionAdapter({
		session: createSession(uiConfig(), catalog),
		catalog,
	})
	adapter.dispatch({ t: 'START' })
	const pic23 = findDef(adapter.state, 'HAND:0', '1PIC23-24')
	adapter.dispatch({ t: 'PLAY_CARD', iid: pic23, operationIndex: 0 })
	const slot0Loc = findDef(adapter.state, 'NEUTRAL_ZONE:0', '1LOC16-20')
	adapter.settle(slot0Loc)
	return adapter.session
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
	catalog = loadBrowserCatalog()
})

describe('deployed-card activation (ui wiring)', () => {
	it('clicking a deployed card opens the detail; Activate dispatches the ACTIVATION', () => {
		const session = sessionWithActivatableDeployedCard()
		act(() => {
			useGameStore.getState().resumeGame(session)
		})
		let store = useGameStore.getState()
		expect(store.error).toBeNull()

		const ent = findDef(store.state!, 'FLEET:0', '1PIC02-24')
		// The adapter's legal list (the UI gate) must include the activation.
		expect(
			store.legal.some((it) => it.t === 'ACTIVATE' && it.iid === ent),
		).toBe(true)

		// Click the deployed card → detail overlay opens.
		act(() => {
			useGameStore.getState().cardClicked(ent)
		})
		expect(useGameStore.getState().detailIid).toBe(ent)

		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		act(() => {
			root.render(<CardDetailHost />)
		})

		const actBtn = host.querySelector(
			'.op-activate',
		) as HTMLButtonElement | null
		expect(actBtn).not.toBeNull()
		expect(host.textContent).toContain('Activate')
		// Debug line: the def and instance ids are shown in the pane.
		expect(host.textContent).toContain('1PIC02-24')
		expect(host.textContent).toContain(`iid: ${ent}`)

		act(() => {
			actBtn!.click()
		})
		store = useGameStore.getState()
		expect(store.state!.cards[ent]!.exhausted).toBe(true)
		// The card is exhausted, so the activation is no longer offered.
		expect(
			store.legal.some((it) => it.t === 'ACTIVATE' && it.iid === ent),
		).toBe(false)
	})

	it('keeps the detail open through the activation’s choices, then closes it', () => {
		const session = sessionWithActivatableDeployedCard()
		act(() => {
			useGameStore.getState().resumeGame(session)
		})
		const ent = findDef(useGameStore.getState().state!, 'FLEET:0', '1PIC02-24')
		act(() => {
			useGameStore.getState().cardClicked(ent)
		})
		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		act(() => {
			root.render(<CardDetailHost />)
		})

		// the first runnable one, operation 1 (pay 1 DIL, then warp), asks
		// before it resolves
		act(() => {
			host.querySelector<HTMLButtonElement>('.op-activate')!.click()
		})
		expect(useGameStore.getState().pendingChoice).not.toBeNull()
		expect(useGameStore.getState().detailIid).toBe(ent)

		let guard = 0
		while (useGameStore.getState().pendingChoice !== null && ++guard < 10) {
			const choice = useGameStore
				.getState()
				.legal.find((it) => it.t === 'RESOLVE_CHOICE')!
			act(() => {
				useGameStore.getState().settle(choice.selection)
			})
		}
		expect(useGameStore.getState().error).toBeNull()
		expect(useGameStore.getState().pendingChoice).toBeNull()
		expect(useGameStore.getState().detailIid).toBeNull()
	})

	it('leaves another card’s detail open when the activation resolves', () => {
		const session = sessionWithActivatableDeployedCard()
		act(() => {
			useGameStore.getState().resumeGame(session)
		})
		const state = useGameStore.getState().state!
		const ent = findDef(state, 'FLEET:0', '1PIC02-24')
		const other = zoneIids(state, 'NEUTRAL_ZONE:1')[0]!
		act(() => {
			useGameStore.getState().cardClicked(ent)
		})
		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		act(() => {
			root.render(<CardDetailHost />)
		})
		act(() => {
			host.querySelector<HTMLButtonElement>('.op-activate')!.click()
		})
		expect(useGameStore.getState().pendingChoice).not.toBeNull()
		// mid-choice, the player opens a Location to read it
		act(() => {
			useGameStore.getState().setDetail(other)
		})
		let guard = 0
		while (useGameStore.getState().pendingChoice !== null && ++guard < 10) {
			const choice = useGameStore
				.getState()
				.legal.find((it) => it.t === 'RESOLVE_CHOICE')!
			act(() => {
				useGameStore.getState().settle(choice.selection)
			})
		}
		expect(useGameStore.getState().pendingChoice).toBeNull()
		expect(useGameStore.getState().detailIid).toBe(other)
	})

	it('folds a deployed card’s PLAY operations into a closed section', () => {
		const session = sessionWithActivatableDeployedCard()
		act(() => {
			useGameStore.getState().resumeGame(session)
		})
		const ent = findDef(useGameStore.getState().state!, 'FLEET:0', '1PIC02-24')
		act(() => {
			useGameStore.getState().cardClicked(ent)
		})
		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		act(() => {
			root.render(<CardDetailHost />)
		})

		const away = host.querySelector('details.op-away') as HTMLDetailsElement
		expect(away).not.toBeNull()
		expect(away.open).toBe(false)
		expect(away.querySelector('summary')!.textContent).toContain('(1)')
		expect(away.textContent).toContain('PLAY')
		expect(away.textContent).toContain('Already in play')
		// the activations stay out in the open, still runnable
		const outside = [...host.querySelectorAll('.op-detail')].filter(
			(el) => !away.contains(el),
		)
		expect(
			outside.map((el) => el.querySelector('.op-type')!.textContent),
		).toEqual(['ACTIVATION', 'ACTIVATION', 'ACTIVATION'])
		expect(away.querySelector('.op-activate')).toBeNull()
	})

	it('an ACTIVATION outside your turn shows a reason instead of a dead row', () => {
		const session = sessionWithActivatableDeployedCard()
		act(() => {
			useGameStore.getState().resumeGame(session)
		})
		// End PIC's turn, then resolve the hand-off choices until SHR's
		// ACTION turn — the deployed Enterprise is still ours but we cannot act.
		act(() => {
			useGameStore.getState().dispatch({ t: 'PASS' })
		})
		let guard = 0
		while (true) {
			const st = useGameStore.getState()
			const choice = st.legal.find((it) => it.t === 'RESOLVE_CHOICE')
			if (choice === undefined) break
			act(() => {
				useGameStore.getState().settle(choice.selection)
			})
			if (++guard > 20) break
		}
		const store = useGameStore.getState()
		expect(store.error).toBeNull()
		expect(store.state!.phase.k).toBe('ACTION')
		expect(store.state!.activeSeat).toBe(1)
		const ent = findDef(store.state!, 'FLEET:0', '1PIC02-24')

		act(() => {
			useGameStore.getState().cardClicked(ent)
		})
		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		act(() => {
			root.render(<CardDetailHost />)
		})

		// The ACTIVATION is visible but not clickable, and the pane explains why.
		expect(host.querySelector('.op-activate')).toBeNull()
		expect(host.textContent).toContain('ACTIVATION')
		expect(host.textContent).toContain('Not your turn')
	})

	it('zooms the hovered card centre stage only while Option is held', () => {
		const session = sessionWithActivatableDeployedCard()
		act(() => {
			useGameStore.getState().resumeGame(session)
		})
		const ent = findDef(useGameStore.getState().state!, 'FLEET:0', '1PIC02-24')

		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		act(() => {
			root.render(<CardZoom />)
		})

		// Hover alone is not enough — that was the old always-on preview.
		act(() => {
			useGameStore.getState().setHoverIid(ent)
		})
		expect(host.querySelector('.zoom-layer')).toBeNull()

		act(() => {
			window.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Alt', altKey: true }),
			)
		})
		expect(host.querySelector('.zoom-layer')).not.toBeNull()
		expect(host.querySelector('.card-zoom')).not.toBeNull()

		// Releasing the key drops it, and so does losing the window (Option-Tab).
		act(() => {
			window.dispatchEvent(
				new KeyboardEvent('keyup', { key: 'Alt', altKey: false }),
			)
		})
		expect(host.querySelector('.zoom-layer')).toBeNull()

		act(() => {
			window.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Alt', altKey: true }),
			)
		})
		expect(host.querySelector('.zoom-layer')).not.toBeNull()
		act(() => {
			window.dispatchEvent(new Event('blur'))
		})
		expect(host.querySelector('.zoom-layer')).toBeNull()

		// Option held but nothing hovered shows nothing.
		act(() => {
			window.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Alt', altKey: true }),
			)
			useGameStore.getState().setHoverIid(null)
		})
		expect(host.querySelector('.zoom-layer')).toBeNull()
	})
})

// ---------------------------------------------------------------------------
// Multi-route PLAY: a card with more than one legal PLAY operation must ask
// which Play action the player wants (regression: the hand used to silently
// auto-play operations[0] and the detail never offered PLAY buttons).
// ---------------------------------------------------------------------------

/** Seed-11 fixture: PIC (seat 0) is the starting player and UTILIZE
 *  (1PIC19-24, a DIRECTIVE with two PLAY operations) is in the opening hand. */
function sessionWithMultiPlayCard(): Session {
	const adapter = new SessionAdapter({
		session: createSession(
			{
				mode: 'TWO_PLAYER' as const,
				players: [
					{ deck: 'PIC' as const, boardSide: 'ADVANCED' as const },
					{ deck: 'SHR' as const, boardSide: 'BASIC' as const },
				],
				seed: 11,
			},
			catalog,
		),
		catalog,
	})
	adapter.dispatch({ t: 'START' })
	return adapter.session
}

describe('multi-route PLAY (which Play action)', () => {
	it('clicking a multi-route card in hand opens the detail instead of auto-playing the first op', () => {
		const session = sessionWithMultiPlayCard()
		act(() => {
			useGameStore.getState().resumeGame(session)
		})
		const store = useGameStore.getState()
		expect(store.error).toBeNull()
		expect(store.state!.phase.k).toBe('ACTION')
		expect(store.state!.activeSeat).toBe(0)

		const util = findDef(store.state!, 'HAND:0', '1PIC19-24')
		const playOps = canPlay(store.state!, 0, util).operations
		expect(playOps).toEqual([0, 1])
		// The engine exposes both legal play intents to the UI.
		expect(
			store.legal.some(
				(it) =>
					it.t === 'PLAY_CARD' && it.iid === util && it.operationIndex === 0,
			),
		).toBe(true)
		expect(
			store.legal.some(
				(it) =>
					it.t === 'PLAY_CARD' && it.iid === util && it.operationIndex === 1,
			),
		).toBe(true)

		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		act(() => {
			root.render(<Hand seat={0} />)
		})
		const cards = Array.from(host.querySelectorAll('.card')) as HTMLElement[]
		const utilCard = cards.find((el) =>
			(el.textContent ?? '').includes('1PIC19/24'),
		)
		expect(utilCard).not.toBeUndefined()
		const clickTarget =
			utilCard!.querySelector<HTMLButtonElement>('.card-inner')!

		act(() => {
			clickTarget.click()
		})
		// NOT auto-played: the card stays in hand and the detail overlay opens.
		const after = useGameStore.getState()
		expect(after.detailIid).toBe(util)
		expect(after.state!.zones['HAND:0']).toContain(util)
	})

	it('the detail offers one Play button per legal PLAY operation and plays the chosen one', () => {
		const session = sessionWithMultiPlayCard()
		act(() => {
			useGameStore.getState().resumeGame(session)
		})
		const store = useGameStore.getState()
		const util = findDef(store.state!, 'HAND:0', '1PIC19-24')
		expect(canPlay(store.state!, 0, util).operations).toEqual([0, 1])

		act(() => {
			useGameStore.getState().cardClicked(util)
		})
		expect(useGameStore.getState().detailIid).toBe(util)

		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		act(() => {
			root.render(<CardDetailHost />)
		})

		const playButtons = Array.from(
			host.querySelectorAll('.op-activate'),
		) as HTMLButtonElement[]
		expect(playButtons).toHaveLength(2)
		// Click the first Play button (the [action]-costing operation).
		act(() => {
			playButtons[0]!.click()
		})
		const after = useGameStore.getState()
		expect(after.error).toBeNull()
		// The card left the hand (PLAY_CARD op 0 resolved) and the detail closed.
		expect(after.state!.zones['HAND:0']).not.toContain(util)
		expect(after.detailIid).toBeNull()
	})
})
