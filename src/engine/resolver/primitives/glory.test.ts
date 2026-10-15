// Glory substitution (todo/05 §8, rules/04 §4.3.2): 1 GLO = 1 LAT, 1 GLO = 2
// DIL for the paying player, NO change given. Payment uses the minimum-Glory
// plan (Glory is 1 VP each — never auto-spend it when the native pool covers
// the cost). 1BUR02 disables the DIL rate (rules/11 §11.6.1 #4).

import { describe, expect, it } from 'vitest'
import {
	fresh,
	register,
	makeDef,
	place,
	op,
	play,
	ID,
	setResources,
	setActions,
} from '../testUtils'
import { canPayResource, payResource } from '../runtime'
import type { GameState } from '../../state'
import { assertSerialisable } from '../../invariants'

function dil3(): GameState {
	register([
		makeDef({
			id: 'glo',
			suit: 'PERSON',
			operations: [
				op('PLAY', {
					k: 'PAY_THEN',
					cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 3 },
					body: { k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
				}),
			],
		}),
	])
	let s = fresh()
	s = place(s, 'glo', ID('g'), { k: 'HAND', seat: 0 }, 0)
	return setActions(s, 0, 1)
}

describe('Glory substitution (rules/04 §4.3.2)', () => {
	it('1 DIL + 1 GLO pays a 3-Dilithium cost exactly', () => {
		const s = setResources(setResources(dil3(), 0, 'DIL', 1), 0, 'GLO', 1)
		expect(canPayResource(s, 0, 'DIL', 3)).toBe(true)
		const out = play(s, ID('g'))
		assertSerialisable(out)
		expect(out.players[0]!.resources.DIL).toBe(0)
		expect(out.players[0]!.resources.GLO).toBe(0) // no change given
		expect(out.players[0]!.resources.LAT).toBe(1) // body resolved
	})

	it('2 DIL + 1 GLO pays 3 DIL and wastes the extra Dilithium (no change)', () => {
		const s = setResources(setResources(dil3(), 0, 'DIL', 2), 0, 'GLO', 1)
		const out = play(s, ID('g'))
		assertSerialisable(out)
		expect(out.players[0]!.resources.DIL).toBe(0)
		expect(out.players[0]!.resources.GLO).toBe(0) // 1 GLO = 2 DIL spent whole; the surplus 1 DIL is lost
		expect(out.players[0]!.resources.LAT).toBe(1)
	})

	it('does NOT auto-spend Glory when the native pool covers the cost', () => {
		const s = setResources(setResources(dil3(), 0, 'DIL', 3), 0, 'GLO', 1)
		const out = play(s, ID('g'))
		assertSerialisable(out)
		expect(out.players[0]!.resources.DIL).toBe(0)
		expect(out.players[0]!.resources.GLO).toBe(1) // kept — it is worth 1 VP each
	})

	it('cannot pay when the combined value falls short', () => {
		const s = setResources(setResources(dil3(), 0, 'DIL', 1), 0, 'GLO', 0)
		expect(canPayResource(s, 0, 'DIL', 3)).toBe(false)
	})

	it('1BUR02 disables substituting Glory for Dilithium', () => {
		let s = setResources(setResources(dil3(), 0, 'DIL', 1), 0, 'GLO', 1)
		s = {
			...s,
			players: s.players.map((p) =>
				p.seat === 0
					? { ...p, modifiers: [{ id: '1BUR02', source: ID('N/A') }] }
					: p,
			) as GameState['players'],
		}
		expect(canPayResource(s, 0, 'DIL', 3)).toBe(false) // 1 DIL only — Glory cannot cover DIL
		// LAT substitution still works
		expect(canPayResource(s, 0, 'LAT', 1)).toBe(true)
	})

	it('payResource records RESOURCE_SPENT; spendResource is the same scarce operation', () => {
		const s = setResources(setResources(fresh(), 0, 'DIL', 5), 0, 'LAT', 0)
		const out = payResource(s, 0, 'DIL', 2)
		expect(out.players[0]!.resources.DIL).toBe(3)
		expect(
			out.eventQueue.some(
				(e) => e.k === 'RESOURCE_SPENT' && e.res === 'DIL' && e.amount === 2,
			),
		).toBe(true)
	})
})
