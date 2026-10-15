// §5 cost pre-validation + benefit skipping (rules/12 §12.1, todo/04 §4–5).
//   - a PAY_THEN whose cost cannot be fully paid is not resolvable: NOTHING
//     mutates, the operation fails upward;
//   - when the cost CAN be paid, the body's unresolvable benefits are skipped
//     silently (log kind SKIPPED) and the sequence continues.

import { describe, expect, it } from 'vitest'
import type { Effect } from '../nodes'
import {
	fresh,
	register,
	makeDef,
	place,
	pushAndRun,
	play,
	op,
	ID,
	setResources,
	setActions,
} from '../testUtils'

describe('PAY_THEN: cost pre-validation', () => {
	it('unpayable cost -> no body mutation, operation failed upward', () => {
		const s = setResources(fresh(), 0, 'DIL', 1)
		const node: Effect = {
			k: 'PAY_THEN',
			cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 2 },
			body: { k: 'GAIN_RESOURCE', res: 'LAT', amount: 5 },
		}
		const out = pushAndRun(s, node, ID('src'), 0)
		// cost not paid, body never ran
		expect(out.players[0]!.resources.DIL).toBe(1)
		expect(out.players[0]!.resources.LAT).toBe(0)
		expect(out.stack).toHaveLength(0)
	})

	it('payable cost is spent BEFORE the body resolves', () => {
		const s = setResources(setResources(fresh(), 0, 'DIL', 5), 0, 'LAT', 0)
		const node: Effect = {
			k: 'PAY_THEN',
			cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 2 },
			body: { k: 'GAIN_RESOURCE', res: 'LAT', amount: 5 },
		}
		const out = pushAndRun(s, node, ID('src'), 0)
		expect(out.players[0]!.resources.DIL).toBe(3)
		expect(out.players[0]!.resources.LAT).toBe(5)
	})

	it('costsAction is an implicit COST_ACTION on the operation', () => {
		register([
			makeDef({
				id: 'spender',
				suit: 'PERSON',
				operations: [
					op(
						'PLAY',
						{ k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
						{ costsAction: true },
					),
				],
			}),
		])
		let s = setActions(fresh(), 0, 1)
		s = place(s, 'spender', ID('s'), { k: 'HAND', seat: 0 }, 0)
		const out = play(s, ID('s'))
		expect(out.players[0]!.actions.available).toBe(0)
		expect(out.players[0]!.resources.DIL).toBe(1)
	})
})

describe('§5: unresolvable benefits are skipped, sequence continues', () => {
	it('PAY_THEN(spend 2 DIL, SEQ[gain CARGO, draw 1]) with empty CARGO offer -> DIL spent, card drawn', () => {
		register([
			makeDef({ id: 'drawcard', suit: 'CARGO', operations: [] }),
			makeDef({
				id: 'payThenCard',
				suit: 'PERSON',
				operations: [
					op('PLAY', {
						k: 'PAY_THEN',
						cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 2 },
						body: {
							k: 'SEQ',
							steps: [
								{ k: 'GAIN_CARD', suits: ['CARGO'] }, // ← no CARGO offer: skipped
								{ k: 'DRAW', count: 1 },
							],
						},
					}),
				],
			}),
		])
		// CARGO offer is EMPTY; player holds 2 DIL; Draw deck has one card.
		let s = setResources(setResources(fresh(), 0, 'DIL', 2), 0, 'LAT', 0)
		s = place(s, 'drawcard', ID('d1'), { k: 'DRAW', seat: 0 }, 0)
		s = place(s, 'payThenCard', ID('c'), { k: 'HAND', seat: 0 }, 0)

		const out = play(s, ID('c'))
		expect(out.players[0]!.resources.DIL).toBe(0) // cost still spent
		expect(out.zones['DRAW:0']).toHaveLength(0) // draw happened
		expect(out.zones['HAND:0']).toContain(ID('d1'))
		const skipped = out.log.filter((l) => l.kind === 'SKIPPED')
		expect(skipped.length).toBeGreaterThanOrEqual(1)
		expect(skipped.some((l) => l.message.includes('GAIN_CARD'))).toBe(true)
	})

	it('a body whose cost gate also fails leaves the operation with only the cost spent', () => {
		// GAIN_CARD(skip) + DRAW with an empty draw deck: DIL still spent.
		register([
			makeDef({
				id: 'payThenCard2',
				suit: 'PERSON',
				operations: [
					op('PLAY', {
						k: 'PAY_THEN',
						cost: { k: 'COST_RESOURCE', res: 'LAT', amount: 1 },
						body: { k: 'GAIN_CARD', suits: ['ALLY'] },
					}),
				],
			}),
		])
		let s = setResources(fresh(), 0, 'LAT', 1)
		s = place(s, 'payThenCard2', ID('c2'), { k: 'HAND', seat: 0 }, 0)
		const out = play(s, ID('c2'))
		expect(out.players[0]!.resources.LAT).toBe(0)
		expect(
			out.log.filter((l) => l.kind === 'SKIPPED').length,
		).toBeGreaterThanOrEqual(1)
	})
})
