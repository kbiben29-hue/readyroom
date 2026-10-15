// Regression: the card-detail overlay must evaluate PLAY/ACTIVATION usability
// against the REAL engine state, not the hidden-info projection. The
// projection replaces every facedown-deck card with HIDDEN_DEF, so any PLAY
// effect that sources a card (RECRUIT/1PIC18 "gain a …", etc.)
// looks unresolvable there — "Why not: Effect cannot be fully resolved" — and
// the overlay offers no Play button even though the engine (and the hand row)
// say the card is playable.

import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { CardCatalog } from '../engine/setup'
import type { CardInstanceId } from '../engine/ids'
import type { GameState } from '../engine/state'
import { createSession, type Session } from '../session/log'
import { SessionAdapter } from '../session/adapter'
import { loadBrowserCatalog } from './browserCatalog'
import { useGameStore, DETAIL_CLICK_WINDOW_MS } from './store'
import { CardDetailHost } from './cards'

let catalog: CardCatalog

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

const findDef = (s: GameState, key: string, def: string): CardInstanceId => {
	const iid = s.zones[key]!.find((i) => s.cards[i]!.def === def)
	if (iid === undefined) throw new Error(`test fixture: ${def} not in ${key}`)
	return iid
}

/** Drive the opening to seat 0's ACTION step with a legal, suit-gaining PLAY
 *  (1PIC18) still in hand, then return that session. */
function sessionWithSuitGainPlay(): Session {
	const adapter = new SessionAdapter({
		session: createSession(uiConfig(), catalog),
		catalog,
	})
	adapter.dispatch({ t: 'START' })
	expect(adapter.state.activeSeat).toBe(0)
	expect(adapter.state.phase.k).toBe('ACTION')
	expect(adapter.pendingChoice).toBeNull()
	return adapter.session
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
	catalog = loadBrowserCatalog()
})

describe('card-detail Play usability uses the real engine state', () => {
	it('offers the Play button for a suit-gaining PLAY in the detail overlay', async () => {
		const session = sessionWithSuitGainPlay()
		act(() => {
			useGameStore.getState().resumeGame(session)
		})
		const store = useGameStore.getState()
		expect(store.error).toBeNull()

		const snw = findDef(store.state!, 'HAND:0', '1PIC18-24')
		// The engine legal list includes the play…
		expect(
			store.legal.some((it) => it.t === 'PLAY_CARD' && it.iid === snw),
		).toBe(true)

		// …and the detail overlay must render a Play button (not "Effect cannot
		// be fully resolved", which is what the projected-state probe produced).
		act(() => {
			useGameStore.getState().cardClicked(snw)
		})
		// SNW has exactly one legal PLAY, so its detail-open is deferred by the
		// double-click window (the feature's single-click vs double-click
		// disambiguation) — wait it out before rendering the overlay.
		await act(async () => {
			await new Promise((resolve) =>
				setTimeout(resolve, DETAIL_CLICK_WINDOW_MS + 50),
			)
		})
		expect(useGameStore.getState().detailIid).toBe(snw)
		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		act(() => {
			root.render(<CardDetailHost />)
		})
		const playBtn = host.querySelector(
			'.op-activate',
		) as HTMLButtonElement | null
		expect(playBtn).not.toBeNull()
		expect(host.textContent).toContain('Play')
		expect(host.textContent).not.toContain('Effect cannot be fully resolved')
	})
})
