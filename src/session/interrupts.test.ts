// Interrupt rules (interrupts.ts) on real engine states: KOL (seat 0) vs
// SIS (seat 1), seed 17, driven by the first-legal driver. Step 20 puts a
// KOL "you may draw a card?" on SIS (a CONFIRM interrupt); with SIS
// declining it, step 23 opens a reaction window for SIS's 1SIS23.

import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from '../data/catalog'
import { nextAutoIntent } from '../bot/autoPlay'
import type { CardCatalog, SetupConfig } from '../engine/setup'
import { setup } from '../engine/setup'
import type { GameState } from '../engine/state'
import { legalIntents, reduce, type Intent } from '../engine/intents'
import {
	decisionSeat,
	interruptChoice,
	standingOrderAnswer,
	standingOrderPolicy,
	timeoutSelection,
} from './interrupts'

const SIS23 = '1SIS23-25'

const config: SetupConfig = {
	mode: 'TWO_PLAYER',
	players: [
		{ deck: 'KOL', boardSide: 'BASIC' },
		{ deck: 'SIS', boardSide: 'BASIC' },
	],
	seed: 17,
}

let catalog: CardCatalog
let states: GameState[]

beforeAll(async () => {
	catalog = await loadCatalog()
	let s = reduce(setup(config, catalog), { t: 'START' }).state
	states = [s]
	for (let i = 0; i < 23; i++) {
		s = reduce(s, nextAutoIntent(s, legalIntents(s)) as Intent).state
		states.push(s)
	}
})

describe('interrupts', () => {
	it('the mover’s own choice is not an interrupt', () => {
		const s = states[1]! // SIS's Captain asks SIS for a Location
		expect(s.pendingChoice?.seat).toBe(1)
		expect(s.activeSeat).toBe(1)
		expect(decisionSeat(s)).toBe(1)
		expect(interruptChoice(s)).toBeNull()
		expect(
			standingOrderAnswer(s, [{}, { '1SIS01-25': 'always' }]),
		).toBeUndefined()
	})

	it('a FORCE/OPPONENT choice on the other seat is; its timeout declines', () => {
		const s = states[20]!
		expect(s.activeSeat).toBe(0)
		expect(interruptChoice(s)).toMatchObject({ k: 'CONFIRM', seat: 1 })
		expect(decisionSeat(s)).toBe(1)
		expect(timeoutSelection(s)).toBe(false)
		// not a reaction and not sourced from SIS's own card: always asked
		expect(standingOrderAnswer(s, [{}, { [SIS23]: 'always' }])).toBeUndefined()
	})

	it('standing orders answer a reaction window: ask / never / always', () => {
		const s = states[23]!
		const choice = interruptChoice(s)
		expect(choice?.k).toBe('OPTIONAL_TRIGGERS')
		if (choice?.k !== 'OPTIONAL_TRIGGERS') throw new Error('expected a window')
		expect(s.cards[choice.offered[0]!.card]!.def).toBe(SIS23)
		expect(standingOrderAnswer(s, [{}, {}])).toBeUndefined()
		// the seat's own orders count, not the opponent's
		expect(standingOrderAnswer(s, [{ [SIS23]: 'always' }, {}])).toBeUndefined()
		expect(standingOrderAnswer(s, [{}, { [SIS23]: 'never' }])).toEqual({
			selection: [],
		})
		expect(standingOrderAnswer(s, [{}, { [SIS23]: 'always' }])).toEqual({
			selection: choice.offered,
		})
		expect(timeoutSelection(s)).toEqual([])
	})

	it('answers a sub-choice of an always-used card with the bot heuristic', () => {
		const s = states[23]!
		const sis23 = Object.values(s.cards).find(
			(c) => c.def === SIS23 && c.owner === 1,
		)!.iid
		const sub: GameState = {
			...s,
			pendingChoice: {
				k: 'CONFIRM',
				id: 'c-sub',
				seat: 1,
				prompt: 'You may draw a card?',
				sourceCard: sis23,
			},
		}
		expect(standingOrderAnswer(sub, [{}, { [SIS23]: 'always' }])).toEqual({
			selection: true, // "always use" accepts the card's own "you may"
		})
		expect(standingOrderAnswer(sub, [{}, {}])).toBeUndefined()
		expect(standingOrderPolicy(sub, sub.pendingChoice!)).toBe(true)
	})
})
