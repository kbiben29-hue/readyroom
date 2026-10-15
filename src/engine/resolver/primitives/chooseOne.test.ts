// §6 CHOOSE_ONE resolvability filtering (rules/03 §3.5.3, todo/04 §6):
//   - options whose body can't fully resolve are presented disabled (with a
//     reason) — unless the operation is an isAttack resolved by the opponent,
//     in which case disabled options are hard-filtered out entirely;
//   - if no option can resolve, the benefit node is skipped.

import { beforeEach, describe, expect, it } from 'vitest'
import {
	fresh,
	register,
	makeDef,
	place,
	pushAndRun,
	play,
	op,
	ID,
	setActions,
} from '../testUtils'
import { chooseOneOptions, isAttackForOpponent } from './chooseOne'
import { assertSerialisable } from '../../invariants'
import type { EffectCtx, JsonValue } from '../../state'
import type { Effect } from '../nodes'

function ctx(
	bindings: Record<string, unknown>,
	actor: 0 | 1 = 0,
	source = 'src',
): EffectCtx {
	return {
		actor,
		source: ID(source),
		bindings: bindings as Record<string, JsonValue>,
	}
}

describe('CHOOSE_ONE: disabled-option filtering', () => {
	beforeEach(() => {
		register([
			makeDef({ id: 'cargo', suit: 'CARGO', operations: [] }),
			makeDef({ id: 'ally', suit: 'ALLY', operations: [] }),
		])
	})

	it('unresolvable options are offered but marked disabled with a reason', () => {
		// CARGO offer empty → that option is disabled; ALLY offer present → enabled.
		let s = fresh()
		s = place(s, 'ally', ID('a'), { k: 'MARKET_OFFER', suit: 'ALLY' })
		const node: Effect = {
			k: 'CHOOSE_ONE',
			options: [
				{ label: 'gain a CARGO', body: { k: 'GAIN_CARD', suits: ['CARGO'] } },
				{ label: 'gain an ALLY', body: { k: 'GAIN_CARD', suits: ['ALLY'] } },
			],
		}
		const out = pushAndRun(s, node, ID('src'), 0)
		expect(out.pendingChoice?.k).toBe('CHOOSE_OPTION')
		const choice = out.pendingChoice
		if (choice === null || choice.k !== 'CHOOSE_OPTION')
			throw new Error('expected a CHOOSE_OPTION')
		expect(choice.seat).toBe(0)
		const opts = choice.options
		expect(opts).toHaveLength(2)
		expect(opts[0]!.enabled).toBe(false)
		expect(opts[0]!.reason).toBeTruthy()
		expect(opts[1]!.enabled).toBe(true)
		assertSerialisable(out)
	})

	it('CHOOSE_ONE direct builder marks the same options', () => {
		const s = fresh()
		const opts = chooseOneOptions(
			s,
			{
				k: 'CHOOSE_ONE',
				options: [{ label: 'a', body: { k: 'GAIN_CARD', suits: ['CARGO'] } }],
			},
			ctx({}),
		)
		expect(opts[0]!.enabled).toBe(false)
	})

	it('an isAttack resolved by the OPPONENT hard-filters disabled options', () => {
		let s = fresh()
		s = place(s, 'ally', ID('a'), { k: 'MARKET_OFFER', suit: 'ALLY' })
		const node: Effect = {
			k: 'CHOOSE_ONE',
			options: [
				{ label: 'gain a CARGO', body: { k: 'GAIN_CARD', suits: ['CARGO'] } }, // disabled
				{ label: 'gain an ALLY', body: { k: 'GAIN_CARD', suits: ['ALLY'] } }, // enabled
			],
		}
		// actor = 1 is the defender; $op.seat = 0 (attacker pushed the op).
		const out = pushAndRun(s, node, ID('src'), 1)
		// no hard-filter yet: without $op.isAttack binding, it's a plain choice
		expect(out.pendingChoice?.k).toBe('CHOOSE_OPTION')

		// With the attack bindings in ctx, the disabled option disappears.
		const ctx2: EffectCtx = ctx({ '$op.isAttack': true, '$op.seat': 0 }, 1)
		expect(isAttackForOpponent(ctx2)).toBe(true)
		const offered = chooseOneOptions(s, node, ctx2).filter((o) =>
			isAttackForOpponent(ctx2) ? o.enabled : true,
		)
		expect(offered).toHaveLength(1)
		expect(offered[0]!.key).toBe('1')
	})

	it('a full ATTACK operation lets the opponent choose only an enabled option', () => {
		register([
			makeDef({
				id: 'attacker',
				suit: 'PERSON',
				operations: [
					op(
						'PLAY',
						{
							k: 'OPPONENT', // resolves on the defender (actor flips to 1)
							body: {
								k: 'CHOOSE_ONE',
								options: [
									{
										label: 'gain a CARGO',
										body: { k: 'GAIN_CARD', suits: ['CARGO'] },
									}, // disabled for p1
									{
										label: 'gain an ALLY',
										body: { k: 'GAIN_CARD', suits: ['ALLY'] },
									}, // enabled
								],
							},
						},
						{ costsAction: true, isAttack: true },
					),
				],
			}),
		])
		let s = setActions(fresh(), 0, 1)
		s = place(s, 'ally', ID('a'), { k: 'MARKET_OFFER', suit: 'ALLY' })
		s = place(s, 'attacker', ID('atk'), { k: 'HAND', seat: 0 }, 0)
		const out = play(s, ID('atk'))
		expect(out.pendingChoice?.k).toBe('CHOOSE_OPTION')
		if (out.pendingChoice === null || out.pendingChoice.k !== 'CHOOSE_OPTION') {
			throw new Error('expected a CHOOSE_OPTION')
		}
		const choice = out.pendingChoice
		expect(choice.seat).toBe(1) // the defender decides
		expect(choice.options.map((o) => o.key)).toEqual(['1']) // only the enabled option
	})

	it('no resolvable option -> the benefit is skipped (SKIPPED log, no choice)', () => {
		const node: Effect = {
			k: 'CHOOSE_ONE',
			options: [
				{ label: 'gain a CARGO', body: { k: 'GAIN_CARD', suits: ['CARGO'] } }, // empty
				{ label: 'gain an ALLY', body: { k: 'GAIN_CARD', suits: ['ALLY'] } }, // empty
			],
		}
		const out = pushAndRun(fresh(), node, ID('src'), 0)
		expect(out.pendingChoice).toBeNull()
		expect(out.stack).toHaveLength(0)
		expect(
			out.log.filter((l) => l.kind === 'SKIPPED').length,
		).toBeGreaterThanOrEqual(1)
	})
})
