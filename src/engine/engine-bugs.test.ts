// Regression tests for two engine rules:
//   1. Taking a REACTION exhausts its card (rules/03 §3.5.5, rules/08
//      `REACTION operations`) — before, nothing did, so one reaction could
//      fire any number of times a turn.
//   2. Printed PLAY operations are dry-run with the card already in the
//      Staging Area (rules/03 §3.5.4) — before, the probe ran while it was
//      still in hand, so HOSTILE CONTACT ("Discard a card to return this
//      card") looked playable as the only card in hand, then failed.

import { beforeAll, describe, expect, it } from 'vitest'
import {
	fresh,
	register,
	place,
	makeDef,
	op,
	ID,
	setActions,
} from './resolver/testUtils'
import { reduce, legalIntents, type Intent } from './intents'
import { canPlay } from './queries/legality'
import { run } from './resolver/stack'
import { applyChoice } from './resolver/choices'
import { player, type GameState } from './state'
import { loadCatalog } from '../data/catalog'

const HOSTILE_CONTACT = '1INC02-6' // action PLAY: pay a discard to send it back
const FILLER = '1PER01-25'

beforeAll(async () => {
	const catalog = await loadCatalog()
	register(catalog.defs)
	register([
		makeDef({
			id: 'eb-attacker',
			suit: 'SHIP',
			operations: [
				op(
					'ACTIVATION',
					{ k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
					{
						isAttack: true,
					},
				),
			],
		}),
		makeDef({
			id: 'eb-reactor',
			suit: 'PERSON',
			operations: [
				op(
					'REACTION',
					{ k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
					{
						trigger: { on: 'ATTACKED' },
					},
				),
				op(
					'REACTION',
					{ k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
					{
						trigger: { on: 'ATTACKED' },
					},
				),
			],
		}),
	])
})

function answer(state: GameState, selection: unknown): GameState {
	const ch = state.pendingChoice
	if (ch === null) throw new Error('expected a pending choice')
	return run(
		applyChoice(state, {
			t: 'RESOLVE_CHOICE',
			choiceId: ch.id,
			selection,
		} as never),
	)
}

/** Seat 0 has two attacking Ships; seat 1 has one reactor. */
function attackSetup(): GameState {
	let s = fresh()
	// Ships in the Fleet: two Duty Officers would exceed the limit (rules/08
	// `promote`) and open a dismissal prompt.
	s = place(s, 'eb-attacker', ID('a1'), { k: 'FLEET', seat: 0 }, 0)
	s = place(s, 'eb-attacker', ID('a2'), { k: 'FLEET', seat: 0 }, 0)
	s = place(s, 'eb-reactor', ID('r'), { k: 'DUTY_OFFICER', seat: 1 }, 1)
	return setActions(s, 0, 3)
}

const attack = (iid: string): Intent => ({
	t: 'ACTIVATE',
	iid: ID(iid),
	operationIndex: 0,
})

describe('taking a REACTION exhausts its card', () => {
	it('exhausts the reacting card, so it is not offered again this turn', () => {
		let s = reduce(attackSetup(), attack('a1')).state
		const ch = s.pendingChoice
		if (ch === null || ch.k !== 'OPTIONAL_TRIGGERS') throw new Error('window')
		expect(ch.offered).toHaveLength(2)
		const glo = player(s, 1).resources.GLO
		s = answer(s, [ch.offered[0]])
		expect(s.pendingChoice).toBeNull() // the sibling op is gone: card exhausted
		expect(player(s, 1).resources.GLO).toBe(glo + 1)
		expect(s.cards['r']!.exhausted).toBe(true)

		// A second attack the same turn: no window for the exhausted reactor.
		s = reduce(s, attack('a2')).state
		expect(s.pendingChoice).toBeNull()
		expect(player(s, 1).resources.GLO).toBe(glo + 1)
	})

	it('choosing two REACTIONs of the same card resolves only the first', () => {
		let s = reduce(attackSetup(), attack('a1')).state
		const ch = s.pendingChoice
		if (ch === null || ch.k !== 'OPTIONAL_TRIGGERS') throw new Error('window')
		const glo = player(s, 1).resources.GLO
		const lat = player(s, 1).resources.LAT
		s = answer(s, [ch.offered[1], ch.offered[0]]) // LAT op first
		expect(s.pendingChoice).toBeNull()
		expect(player(s, 1).resources.LAT).toBe(lat + 1)
		expect(player(s, 1).resources.GLO).toBe(glo)
		expect(s.cards['r']!.exhausted).toBe(true)
	})

	it('declining leaves the card unexhausted', () => {
		let s = reduce(attackSetup(), attack('a1')).state
		s = answer(s, [])
		expect(s.cards['r']!.exhausted).toBe(false)
	})
})

describe('printed PLAY operations are dry-run from the Staging Area', () => {
	function handSetup(extra: boolean): GameState {
		let s = fresh()
		s = place(s, HOSTILE_CONTACT, ID('inc'), { k: 'HAND', seat: 0 }, 0)
		if (extra) s = place(s, FILLER, ID('h1'), { k: 'HAND', seat: 0 }, 0)
		return setActions(s, 0, 1)
	}

	it('the INCIDENT cannot pay its own discard cost', () => {
		const s = handSetup(false)
		expect(canPlay(s, 0, ID('inc')).operations).not.toContain(0)
		expect(legalIntents(s)).not.toContainEqual({
			t: 'PLAY_CARD',
			iid: ID('inc'),
			operationIndex: 0,
		})
	})

	it('is playable with another card in hand to discard', () => {
		const s = handSetup(true)
		expect(canPlay(s, 0, ID('inc')).operations).toContain(0)
	})
})
