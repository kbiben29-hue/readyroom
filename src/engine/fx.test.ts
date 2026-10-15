// Token-movement trail (src/engine/fx.ts): every EFFECT step that moves tokens
// appends its net changes, attributed to the card whose effect made them —
// so the UI can fly a passive's Dilithium out of that passive's card.

import { describe, expect, it } from 'vitest'
import {
	fresh,
	register,
	makeDef,
	place,
	ID,
	play,
	pushAndRun,
	setResources,
	setActions,
} from './resolver/testUtils'
import { poolDiff } from './fx'

register([
	makeDef({
		id: 'fx-console',
		suit: 'SHIP',
		operations: [
			{
				type: 'ACTIVATION',
				costsAction: true,
				isAttack: false,
				effect: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 2 },
				text: 'gain 2 DIL',
			},
		],
	}),
	makeDef({
		id: 'fx-passive',
		suit: 'PERSON',
		operations: [
			{
				type: 'PASSIVE',
				costsAction: false,
				isAttack: false,
				trigger: { on: 'INCIDENT_TAKEN' },
				effect: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
				text: 'after taking an INCIDENT, gain 1 DIL',
			},
		],
	}),
	makeDef({ id: 'fx-inc', suit: 'INCIDENT', operations: [] }),
	makeDef({ id: 'fx-src', suit: 'ALLY', operations: [] }),
])

describe('fx trail', () => {
	it('attributes an action cost and a gain to the activated card', () => {
		let s = fresh()
		s = setActions(s, 0, 3)
		s = place(s, 'fx-console', ID('con'), { k: 'FLEET', seat: 0 }, 0)
		s = play(s, ID('con'))
		expect(s.fx).toEqual([
			{
				source: 'con',
				changes: [{ pool: { k: 'PLAYER', seat: 0, res: 'ACTION' }, delta: -1 }],
			},
			{
				source: 'con',
				changes: [{ pool: { k: 'PLAYER', seat: 0, res: 'DIL' }, delta: 2 }],
			},
		])
		expect(s.players[0].actions).toEqual({ available: 2, spent: 1 })
	})

	it("attributes a triggered passive's gain to the passive card", () => {
		let s = fresh()
		s = place(s, 'fx-passive', ID('pas'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		// two Incidents: taking the last one would end the game (the Burn)
		s = place(s, 'fx-inc', ID('i1'), { k: 'INCIDENT_DECK' })
		s = place(s, 'fx-inc', ID('i2'), { k: 'INCIDENT_DECK' })
		s = pushAndRun(s, { k: 'TAKE', deck: 'INCIDENT', count: 1 }, ID('src'), 0)
		expect(s.fx).toContainEqual({
			source: 'pas',
			changes: [{ pool: { k: 'PLAYER', seat: 0, res: 'DIL' }, delta: 1 }],
		})
	})

	it('records a steal as one step: out of the victim, into the thief', () => {
		let s = fresh()
		s = setResources(s, 1, 'LAT', 3)
		s = place(s, 'fx-src', ID('thief'), { k: 'FLEET', seat: 0 }, 0)
		s = pushAndRun(s, { k: 'STEAL', res: 'LAT', amount: 2 }, ID('thief'), 0)
		expect(s.fx).toEqual([
			{
				source: 'thief',
				changes: [
					{ pool: { k: 'PLAYER', seat: 0, res: 'LAT' }, delta: 2 },
					{ pool: { k: 'PLAYER', seat: 1, res: 'LAT' }, delta: -2 },
				],
			},
		])
	})

	it('poolDiff sees card tokens and the Stardate glory', () => {
		let a = fresh()
		a = place(a, 'fx-src', ID('m1'), { k: 'FLEET', seat: 0 }, 0)
		const b = {
			...a,
			cards: {
				...a.cards,
				m1: { ...a.cards['m1']!, resourceTokens: { GLO: 2 } },
			},
			stardates: { ...a.stardates, gloryOnTop: a.stardates.gloryOnTop - 1 },
		}
		expect(poolDiff(a, b)).toEqual([
			{ pool: { k: 'CARD', iid: 'm1', res: 'GLO' }, delta: 2 },
			{ pool: { k: 'STARDATE' }, delta: -1 },
		])
	})

	it('records nothing for a step that moves no tokens', () => {
		let s = fresh()
		s = pushAndRun(s, { k: 'NOOP' }, ID('x'), 0)
		expect(s.fx).toEqual([])
	})
})
