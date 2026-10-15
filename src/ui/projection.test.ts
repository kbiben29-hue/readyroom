// Hot-seat projection tests (todo/14 §1 — Definition of Done).
//
// `project(state, viewerSeat)` is what every component renders; the DoD
// requires that it hides the opponent's hidden information. Assertions:
//   - the opponent's HAND collapses to HIDDEN_DEF card backs (count kept);
//   - facedown decks (DRAW / RESERVE of either player + shared NONE piles)
//     collapse to HIDDEN_DEF;
//   - the viewer's own hand and all public zones keep their real defs;
//   - switching the viewer seat flips the same hiding.

import { describe, expect, it, beforeEach } from 'vitest'
import type { CardCatalog, SetupConfig } from '../engine/setup'
import type { GameState } from '../engine/state'
import { zoneKey } from '../engine/state'
import { createSession } from '../session/log'
import { SessionAdapter } from '../session/adapter'
import { loadBrowserCatalog } from './browserCatalog'
import { project, HIDDEN_DEF, type ProjectedState } from './projection'

let catalog: CardCatalog

const config = (): SetupConfig => ({
	mode: 'TWO_PLAYER',
	players: [
		{ deck: 'PIC', boardSide: 'BASIC' },
		{ deck: 'SHR', boardSide: 'BASIC' },
	],
	seed: 424242,
})

function freshState(): GameState {
	// SessionAdapter replays createSession → setup once; the state is the
	// SETUP-phase state (5-card hands, full draw decks).
	return new SessionAdapter({
		session: createSession(config(), catalog),
		catalog,
	}).state
}

function defsOf(state: ProjectedState, key: string): string[] {
	const zone = state.zones[key] ?? []
	return zone.map((iid) => state.cards[iid]?.def ?? 'MISSING')
}

beforeEach(() => {
	catalog = loadBrowserCatalog()
})

describe('project(state, viewerSeat) hot-seat hiding', () => {
	it('hides the opponent hand behind HIDDEN_DEF but keeps counts', () => {
		const state = freshState()
		const mine = state.players[0]
		const theirs = state.players[1]
		// Sanity: setup really dealt two full 5-card hands.
		expect(state.zones[zoneKey({ k: 'HAND', seat: 0 })]).toHaveLength(
			mine.handSize,
		)
		expect(state.zones[zoneKey({ k: 'HAND', seat: 1 })]).toHaveLength(
			theirs.handSize,
		)

		const view = project(state, 0)
		const ownHand = defsOf(view, zoneKey({ k: 'HAND', seat: 0 }))
		const oppHand = defsOf(view, zoneKey({ k: 'HAND', seat: 1 }))

		expect(ownHand).toHaveLength(mine.handSize)
		for (const def of ownHand) expect(def).not.toBe(HIDDEN_DEF)
		// opponent's hand is entirely facedown, same count as the raw state
		expect(oppHand).toHaveLength(theirs.handSize)
		expect(oppHand.every((d) => d === HIDDEN_DEF)).toBe(true)
	})

	it('hides both players facedown draw/reserve decks', () => {
		const state = freshState()
		for (const seat of [0, 1] as const) {
			const key = zoneKey({ k: 'DRAW', seat })
			expect(state.zones[key] ?? []).not.toHaveLength(0)
			const view = project(state, 0)
			for (const def of defsOf(view, key)) expect(def).toBe(HIDDEN_DEF)
		}
	})

	it('keeps public zones readable — the Stardate pile is face up, current card visible', () => {
		const state = freshState()
		const view = project(state, 0)
		// STARDATE_PILE is visibleTo 'ALL' (zoneProps; rules/02 §2.1 #2 — faceup
		// pile with #1 on top): the current card's def projects readable, not hidden.
		const pile = defsOf(view, zoneKey({ k: 'STARDATE_PILE' }))
		expect(pile).toHaveLength(5) // the five 2-PLAYER cards (SD01–SD05) in TWO_PLAYER mode
		expect(pile[0]).toBe('sd-01') // #1 sits on top, face up
		for (const def of pile) expect(def).not.toBe(HIDDEN_DEF)
	})

	it('switching viewer seats flips which hand is hidden', () => {
		const state = freshState()
		const view0 = project(state, 0)
		const view1 = project(state, 1)

		const hand0DefsForViewer0 = defsOf(view0, zoneKey({ k: 'HAND', seat: 0 }))
		const hand0DefsForViewer1 = defsOf(view1, zoneKey({ k: 'HAND', seat: 0 }))
		const hand1DefsForViewer0 = defsOf(view0, zoneKey({ k: 'HAND', seat: 1 }))
		const hand1DefsForViewer1 = defsOf(view1, zoneKey({ k: 'HAND', seat: 1 }))

		expect(hand0DefsForViewer0.some((d) => d !== HIDDEN_DEF)).toBe(true)
		expect(hand0DefsForViewer1.every((d) => d === HIDDEN_DEF)).toBe(true)
		expect(hand1DefsForViewer0.every((d) => d === HIDDEN_DEF)).toBe(true)
		expect(hand1DefsForViewer1.some((d) => d !== HIDDEN_DEF)).toBe(true)
	})

	it('project returns a deep copy — mutating it cannot reach the real state', () => {
		const state = freshState()
		const view = project(state, 0)
		const handKey = zoneKey({ k: 'HAND', seat: 0 })
		const firstIid = (view.zones[handKey] ?? [])[0]
		if (firstIid !== undefined) {
			const clone = view.cards[firstIid]
			if (clone !== undefined) {
				;(clone as { def: string }).def = 'MUTATED'
			}
		}
		// the raw state is untouched
		const rawDef = state.cards[(state.zones[handKey] ?? [])[0]!]!.def
		expect(rawDef).not.toBe('MUTATED')
	})

	it('shows the chooser the deck cards a scan put in front of them — and only them', () => {
		const state = freshState()
		const deck = state.zones[zoneKey({ k: 'MARKET_DECK', suit: 'SHIP' })]!
		const [a, b, c] = [deck[0]!, deck[1]!, deck[2]!]
		const base = { id: 'c1', seat: 0 as const, sourceCard: null }
		const scan: GameState = {
			...state,
			pendingChoice: {
				...base,
				k: 'CHOOSE_CARDS',
				prompt: 'Gain a SHIP from the scan',
				candidates: [a, b, c],
				hidden: [c], // a blind deck-top pick stays face down
				min: 1,
				max: 1,
				from: 'MARKET:SHIP',
			},
		}
		const view0 = project(scan, 0)
		expect(view0.cards[a]!.def).toBe(state.cards[a]!.def)
		expect(view0.cards[b]!.def).toBe(state.cards[b]!.def)
		expect(view0.cards[c]!.def).toBe(HIDDEN_DEF)
		expect(view0.cards[deck[3]!]!.def).toBe(HIDDEN_DEF) // not revealed
		// the other seat learns nothing
		expect(project(scan, 1).cards[a]!.def).toBe(HIDDEN_DEF)

		const order: GameState = {
			...state,
			pendingChoice: {
				...base,
				k: 'ORDER_CARDS',
				prompt: 'order',
				cards: [b, c],
			},
		}
		expect(project(order, 0).cards[b]!.def).toBe(state.cards[b]!.def)
		expect(project(order, 0).cards[c]!.def).toBe(state.cards[c]!.def)
		expect(project(order, 1).cards[b]!.def).toBe(HIDDEN_DEF)
	})
})
