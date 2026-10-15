// The online wire view (seatView.ts): what a seat receives must name no card
// it cannot see — not by def, not by instance id (ids are minted in catalog
// order, so a real id in a hidden zone names the card), not by the key order
// of `cards`, not through the RNG — while positional aliases stay usable for
// submissions. Plus the reveal detectors behind the online undo floor.

import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from '../data/catalog'
import { nextAutoIntent } from '../bot/autoPlay'
import type { CardCatalog, SetupConfig } from './setup'
import { setup } from './setup'
import type { GameState } from './state'
import { zoneKey } from './state'
import { legalIntents, reduce, type Intent } from './intents'
import { HIDDEN_DEF, hiddenCards } from './projection'
import {
	HIDDEN_IID,
	IID_TOKEN,
	isHiddenAlias,
	maskValue,
	revealedCards,
	rngDraws,
	seatMask,
	seatView,
	unmaskValue,
} from './seatView'

let catalog: CardCatalog

// KOL (seat 0) vs SIS (seat 1), seed 17: SIS starts. Driven by the
// first-legal driver, step 1 activates SIS's Captain (a choice, nothing
// revealed), step 6 refills the Market (a reveal), step 7 reshuffles.
const config: SetupConfig = {
	mode: 'TWO_PLAYER',
	players: [
		{ deck: 'KOL', boardSide: 'BASIC' },
		{ deck: 'SIS', boardSide: 'BASIC' },
	],
	seed: 17,
}

beforeAll(async () => {
	catalog = await loadCatalog()
})

/** States after each driver step (index 0 = right after START). */
function drive(steps: number): GameState[] {
	let s = reduce(setup(config, catalog), { t: 'START' }).state
	const out = [s]
	for (let i = 0; i < steps; i++) {
		const intent = nextAutoIntent(s, legalIntents(s)) as Intent
		s = reduce(s, intent).state
		out.push(s)
	}
	return out
}

function realIdsIn(json: string): string[] {
	return json.match(IID_TOKEN) ?? []
}

describe('seatView', () => {
	it('names no hidden card by def or by real id', () => {
		const state = drive(0)[0]!
		for (const seat of [0, 1] as const) {
			const hidden = hiddenCards(state, seat)
			expect(hidden.size).toBeGreaterThan(0)
			const view = seatView(state, seat)
			const json = JSON.stringify(view)
			for (const id of realIdsIn(json))
				expect(hidden.has(id as never)).toBe(false)
			// every hidden card is still there, face down, under an alias
			const aliases = Object.keys(view.cards).filter(isHiddenAlias)
			expect(aliases).toHaveLength(hidden.size)
			for (const alias of aliases)
				expect(view.cards[alias]!.def).toBe(HIDDEN_DEF)
		}
	})

	it('keeps the own hand real and aliases the opponent hand by position', () => {
		const state = drive(0)[0]!
		const view = seatView(state, 1)
		const own = view.zones[zoneKey({ k: 'HAND', seat: 1 })]!
		expect(own).toEqual(state.zones[zoneKey({ k: 'HAND', seat: 1 })])
		const theirs = view.zones[zoneKey({ k: 'HAND', seat: 0 })]!
		expect(theirs).toEqual(theirs.map((_, i) => `hidden:HAND:0:${i}`))
		const deck = view.zones[zoneKey({ k: 'DRAW', seat: 1 })]!
		expect(deck.every(isHiddenAlias)).toBe(true)
	})

	it('drops the seed, the stack and the other seat’s pending choice', () => {
		const states = drive(1) // SIS's Captain asks for a Location
		const state = states[1]!
		expect(state.pendingChoice?.seat).toBe(1)
		expect(state.rng.seed).toBe(17)
		const mine = seatView(state, 1)
		const theirs = seatView(state, 0)
		expect(mine.rng).toEqual({ seed: 0, counter: 0 })
		expect(mine.stack).toEqual([])
		expect(mine.eventQueue).toEqual([])
		expect(mine.pendingChoice?.id).toBe(state.pendingChoice!.id)
		expect(theirs.pendingChoice).toBeNull()
	})

	it('sorts the cards map so key order carries no mint order', () => {
		const view = seatView(drive(0)[0]!, 0)
		const keys = Object.keys(view.cards)
		expect(keys).toEqual([...keys].sort())
	})

	it('round-trips positional aliases through unmaskValue', () => {
		const state = drive(0)[0]!
		const mask = seatMask(state, 0)
		const deck = state.zones[zoneKey({ k: 'DRAW', seat: 0 })]!
		const masked = maskValue({ pick: deck.slice(0, 2) }, mask, 'board')
		expect(masked.pick.every(isHiddenAlias)).toBe(true)
		expect(unmaskValue(masked, mask)).toEqual({ pick: deck.slice(0, 2) })
	})

	it('masks history references opaquely (no deck position in the log)', () => {
		const state = drive(0)[0]!
		const mask = seatMask(state, 0)
		const top = state.zones[zoneKey({ k: 'DRAW', seat: 1 })]![0]!
		const entry = { kind: 'EVENT', message: `warped ${top} away`, iid: top }
		expect(maskValue(entry, mask, 'history')).toEqual({
			kind: 'EVENT',
			message: `warped ${HIDDEN_IID} away`,
			iid: HIDDEN_IID,
		})
	})
})

describe('reveal detection', () => {
	it('a published choice is not randomness; a reshuffle is', () => {
		const s = drive(7)
		expect(rngDraws(s[0]!, s[1]!)).toBe(0) // step 1: choice published
		expect(s[1]!.rng.counter).toBe(s[0]!.rng.counter + 1)
		expect(rngDraws(s[6]!, s[7]!)).toBeGreaterThan(0) // step 7: reshuffle
	})

	it('reports faces that became visible to a seat', () => {
		const s = drive(6)
		expect(revealedCards(s[0]!, s[1]!, 1)).toEqual([])
		// step 3 plays a card from SIS's hand: visible to KOL, not new to SIS
		expect(revealedCards(s[2]!, s[3]!, 0)).toHaveLength(1)
		expect(revealedCards(s[2]!, s[3]!, 1)).toEqual([])
		// step 6 refills the Market from its facedown deck: new to both
		expect(revealedCards(s[5]!, s[6]!, 1)).toHaveLength(1)
	})

	it('computes draws from the counter minus the one new choice', () => {
		const base = drive(0)[0]!
		const at = (counter: number, choiceId: string | null): GameState => ({
			...base,
			rng: { ...base.rng, counter },
			pendingChoice:
				choiceId === null
					? null
					: {
							k: 'CONFIRM',
							id: choiceId,
							seat: 0,
							prompt: '',
							sourceCard: null,
						},
		})
		expect(rngDraws(at(5, null), at(6, 'a'))).toBe(0)
		expect(rngDraws(at(5, 'a'), at(9, null))).toBe(4)
		expect(rngDraws(at(5, 'a'), at(9, 'b'))).toBe(3)
	})
})
