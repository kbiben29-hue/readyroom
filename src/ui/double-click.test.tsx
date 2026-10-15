// Single-click vs double-click on cards (the detail/double-click feature):
//   - single click ALWAYS opens the card detail view ("what can I do");
//   - a card with exactly one legal action runs that action on double-click.
// A single-legal-route card defers its detail-open by DETAIL_CLICK_WINDOW_MS so
// its second click (which would otherwise land on the modal backdrop once the
// detail opened on the first click) is still seen by the card and can run the
// action. Everything else — blocked, multi-route, not your turn — opens the
// detail immediately, with no delay.
//
// Fixtures mirror the opening of the PIC-vs-SHR walkthrough
// (src/session/playGame.ts): seed 25 drives to a hand with single-legal-route
// plays (1PIC18 / 1PIC24) and a deployed multi-activation
// card (1PIC02).

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { CardCatalog } from '../engine/setup'
import type { CardInstanceId } from '../engine/ids'
import type { GameState } from '../engine/state'
import { createSession, type Session } from '../session/log'
import { SessionAdapter } from '../session/adapter'
import { loadBrowserCatalog } from './browserCatalog'
import { useGameStore, DETAIL_CLICK_WINDOW_MS } from './store'
import { Hand } from './board'
import { canPlay } from '../engine/queries/legality'
import {
	fresh,
	register,
	makeDef,
	place,
	op,
	ID,
} from '../engine/resolver/testUtils'

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
	const iid = (s.zones[key] ?? []).find((i) => s.cards[i]!.def === def)
	if (iid === undefined) throw new Error(`test fixture: ${def} not in ${key}`)
	return iid
}

/** Seed-25 opening to seat 0's ACTION step: 1PIC18-24 is
 *  still in hand with exactly one legal PLAY and the Enterprise (1PIC02-24) is
 *  deployed in FLEET with multiple legal ACTIVATIONs. */
function sessionWithSnw(): Session {
	const adapter = new SessionAdapter({
		session: createSession(uiConfig(), catalog),
		catalog,
	})
	adapter.dispatch({ t: 'START' })
	adapter.dispatch({
		t: 'PLAY_CARD',
		iid: findDef(adapter.state, 'HAND:0', '1PIC23-24'),
		operationIndex: 0,
	})
	adapter.settle(findDef(adapter.state, 'NEUTRAL_ZONE:0', '1LOC16-20'))
	return adapter.session
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
	catalog = loadBrowserCatalog()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('single click always opens the card detail view', () => {
	it('a single click on a single-legal-route hand card opens the detail (deferred, not a play)', async () => {
		act(() => {
			useGameStore.getState().resumeGame(sessionWithSnw())
		})
		const store = useGameStore.getState()
		const snw = findDef(store.state!, 'HAND:0', '1PIC18-24')
		expect(canPlay(store.state!, 0, snw).operations).toEqual([0])

		act(() => {
			useGameStore.getState().cardClicked(snw)
		})
		// Not yet: the detail-open is deferred to leave room for a double-click.
		expect(useGameStore.getState().detailIid).toBeNull()

		await act(async () => {
			await sleep(DETAIL_CLICK_WINDOW_MS + 50)
		})
		expect(useGameStore.getState().detailIid).toBe(snw)
		// The click did NOT play the card.
		expect(useGameStore.getState().session!.log.at(-1)?.t).not.toBe('PLAY_CARD')
		expect(useGameStore.getState().state!.zones['HAND:0']).toContain(snw)
	})

	it('a single click on a multi-route or blocked card opens the detail immediately', () => {
		act(() => {
			useGameStore.getState().resumeGame(sessionWithSnw())
		})
		const store = useGameStore.getState()
		// The deployed Enterprise has several legal ACTIVATIONs → not a single
		// legal action, so there is nothing to disambiguate and the detail opens
		// with no delay.
		const ent = findDef(store.state!, 'FLEET:0', '1PIC02-24')
		act(() => {
			useGameStore.getState().cardClicked(ent)
		})
		expect(useGameStore.getState().detailIid).toBe(ent)
	})
})

describe('double click runs a card’s single legal action', () => {
	it('double-clicking a single-legal-route hand card plays it (no detail)', () => {
		act(() => {
			useGameStore.getState().resumeGame(sessionWithSnw())
		})
		const store = useGameStore.getState()
		const snw = findDef(store.state!, 'HAND:0', '1PIC18-24')

		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		act(() => {
			root.render(<Hand seat={0} />)
		})
		const cardInner = Array.from(
			host.querySelectorAll<HTMLElement>('.card-inner'),
		).find((el) => el.getAttribute('aria-label') === '1PIC18/24')
		expect(cardInner).not.toBeUndefined()

		act(() => {
			cardInner!.click()
			cardInner!.click()
		})
		const after = useGameStore.getState()
		expect(after.error).toBeNull()
		expect(after.detailIid).toBeNull()
		expect(after.session!.log.at(-1)).toEqual({
			t: 'PLAY_CARD',
			iid: snw,
			operationIndex: 0,
		})
	})

	it('double-clicking a multi-route deployed card does NOT auto-trigger anything', () => {
		act(() => {
			useGameStore.getState().resumeGame(sessionWithSnw())
		})
		const store = useGameStore.getState()
		const ent = findDef(store.state!, 'FLEET:0', '1PIC02-24')
		const intentCount = store.session!.log.length

		act(() => {
			useGameStore.getState().cardClicked(ent)
			useGameStore.getState().cardClicked(ent)
		})
		const after = useGameStore.getState()
		// No ACTIVATE was dispatched…
		expect(after.session!.log).toHaveLength(intentCount)
		expect(after.state!.cards[ent]!.exhausted).toBe(false)
		// …and (no ambiguity) the detail is open.
		expect(after.detailIid).toBe(ent)
	})

	it('dispatches ACTIVATE when the card’s single legal action is an ACTIVATION (store-level)', () => {
		// A synthetic in-play card with exactly one legal ACTIVATION — the same
		// engine surface singleLegalAction reports for the real catalog, driven
		// through store.cardClicked (the double-click path).
		register([
			makeDef({
				id: 'soloact',
				suit: 'SHIP',
				operations: [
					op('ACTIVATION', {
						k: 'GAIN_RESOURCE',
						res: 'DIL',
						amount: 1,
					} as never),
				],
			}),
		])
		const state = place(fresh(), 'soloact', ID('x'), { k: 'FLEET', seat: 0 }, 0)
		useGameStore.getState().newGame()
		useGameStore.setState({
			state,
			viewerSeat: 0,
			legal: [{ t: 'ACTIVATE', iid: ID('x'), operationIndex: 0 }],
		} as never)
		const dispatchSpy = vi
			.spyOn(useGameStore.getState(), 'dispatch')
			.mockImplementation(() => {})

		act(() => {
			useGameStore.getState().cardClicked(ID('x'))
			useGameStore.getState().cardClicked(ID('x'))
		})
		expect(dispatchSpy).toHaveBeenCalledWith({
			t: 'ACTIVATE',
			iid: ID('x'),
			operationIndex: 0,
		})
		expect(useGameStore.getState().detailIid).toBeNull()
	})
})
