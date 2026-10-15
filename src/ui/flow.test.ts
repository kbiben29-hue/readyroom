// Flight planning (flow.ts): which token flies from where to where, per step.

import { describe, expect, it } from 'vitest'
import type { TokenFx } from '../engine/state'
import type { CardInstanceId } from '../engine/ids'
import { planFlights, planWave, residualChanges, type Motion } from './flow'

const ID = (s: string) => s as CardInstanceId
const P = (seat: 0 | 1, res: 'DIL' | 'LAT' | 'GLO' | 'ACTION') =>
	({ k: 'PLAYER', seat, res }) as const

describe('planWave', () => {
	it("a passive's gain flies out of the passive card into the pool", () => {
		const [f] = planWave([{ pool: P(0, 'DIL'), delta: 2 }], ID('1SIS24'))
		expect(f).toMatchObject({
			kind: 'DIL',
			n: 2,
			from: ['card:1SIS24', 'seat:0', 'supply'],
			to: ['player:0:DIL', 'seat:0', 'supply'],
			fromPool: null,
			toPool: 'player:0:DIL',
			source: '1SIS24',
		})
	})

	it('a paid cost flies out of the pool into the card being paid for', () => {
		const [f] = planWave([{ pool: P(0, 'ACTION'), delta: -1 }], ID('nav'))
		expect(f).toMatchObject({
			kind: 'ACTION',
			n: 1,
			from: ['player:0:ACTION', 'seat:0', 'supply'],
			to: ['card:nav', 'seat:0', 'supply'],
			fromPool: 'player:0:ACTION',
			toPool: null,
		})
	})

	it('a steal is one transfer from the victim to the thief', () => {
		const flights = planWave(
			[
				{ pool: P(0, 'LAT'), delta: 2 },
				{ pool: P(1, 'LAT'), delta: -2 },
			],
			ID('thief'),
		)
		expect(flights).toHaveLength(1)
		expect(flights[0]).toMatchObject({
			n: 2,
			fromPool: 'player:1:LAT',
			toPool: 'player:0:LAT',
		})
	})

	it('Market glory flies from the card to the pool; Stardate glory from the track', () => {
		const flights = planWave(
			[
				{ pool: { k: 'CARD', iid: ID('m1'), res: 'GLO' }, delta: -1 },
				{ pool: { k: 'STARDATE' }, delta: -2 },
				{ pool: P(1, 'GLO'), delta: 3 },
			],
			null,
		)
		expect(
			flights.map((f) => [f.from[0], f.to[0], f.n, f.fromPool, f.toPool]),
		).toEqual([
			['card:m1', 'player:1:GLO', 1, 'card:m1:GLO', 'player:1:GLO'],
			['stardate', 'player:1:GLO', 2, 'stardate', 'player:1:GLO'],
		])
	})

	it('with no source card, the supply stands in', () => {
		const [f] = planWave([{ pool: P(1, 'ACTION'), delta: 3 }], null)
		expect(f!.from).toEqual(['supply'])
	})
})

describe('planFlights', () => {
	it('one wave per step in resolution order, phase bookkeeping last', () => {
		const fx: TokenFx[] = [
			{ source: ID('c'), changes: [{ pool: P(0, 'ACTION'), delta: -1 }] },
			{ source: ID('c'), changes: [{ pool: P(0, 'DIL'), delta: 1 }] },
		]
		const motion: Motion = {
			seq: 1,
			fx,
			residual: [{ pool: P(0, 'ACTION'), delta: 3 }],
			logFrom: 0,
		}
		const waves = planFlights(motion)
		expect(waves.map((w) => w.map((f) => `${f.kind}${f.n}`))).toEqual([
			['ACTION1'],
			['DIL1'],
			['ACTION3'],
		])
	})

	it('residualChanges removes what the fx trail already explains', () => {
		const fx: TokenFx[] = [
			{ source: ID('c'), changes: [{ pool: P(0, 'DIL'), delta: 2 }] },
		]
		expect(
			residualChanges(
				[
					{ pool: P(0, 'DIL'), delta: 2 },
					{ pool: P(0, 'ACTION'), delta: 1 },
				],
				fx,
			),
		).toEqual([{ pool: P(0, 'ACTION'), delta: 1 }])
	})
})
