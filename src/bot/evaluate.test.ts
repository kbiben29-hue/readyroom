// Static evaluation sanity (house AI, todo/15 §4): the feature vector is
// aligned with FEATURE_NAMES, and the evaluation moves the right way when a
// seat gains VP, resources or progress.

import { beforeAll, describe, expect, it } from 'vitest'

import { loadCatalog } from '../data/catalog'
import type { CardCatalog } from '../engine/setup'
import { setup } from '../engine/setup'
import type { GameState } from '../engine/state'
import { finalizeGame } from '../engine/scoring'
import type { Seat } from '../engine/resolver/queries'
import { autoPlay } from './autoPlay'
import {
	EVAL_WEIGHTS,
	FEATURE_INDEX,
	FEATURE_NAMES,
	evaluate,
	evaluateNormalized,
	features,
	WIN_VALUE,
} from './evaluate'

let catalog: CardCatalog
let mid: GameState

beforeAll(async () => {
	catalog = await loadCatalog()
	const start = setup(
		{
			mode: 'TWO_PLAYER',
			players: [
				{ deck: 'KOL', boardSide: 'ADVANCED' },
				{ deck: 'SEL', boardSide: 'ADVANCED' },
			],
			seed: 5,
		},
		catalog,
	)
	autoPlay(start, undefined, 120, (s, _i, step) => {
		if (step === 119) mid = s
	})
})

function bump(
	state: GameState,
	seat: Seat,
	f: (p: GameState['players'][number]) => GameState['players'][number],
): GameState {
	const players = state.players.map((p) =>
		p.seat === seat ? f(p) : p,
	) as GameState['players']
	return { ...state, players }
}

const res =
	(r: 'DIL' | 'LAT' | 'GLO', n: number) =>
	(p: GameState['players'][number]) => ({
		...p,
		resources: { ...p.resources, [r]: p.resources[r] + n },
	})

describe('features', () => {
	it('is aligned with FEATURE_NAMES and every name has a weight', () => {
		expect(mid.result).toBeNull()
		expect(features(mid, 0)).toHaveLength(FEATURE_NAMES.length)
		expect(Object.keys(EVAL_WEIGHTS).sort()).toEqual([...FEATURE_NAMES].sort())
		expect(new Set(FEATURE_NAMES).size).toBe(FEATURE_NAMES.length)
		for (const v of features(mid, 1)) expect(Number.isFinite(v)).toBe(true)
	})

	it('reports the resources and the score', () => {
		const f = features(bump(mid, 0, res('DIL', 2)), 0)
		expect(f[FEATURE_INDEX['res.DIL']]).toBe(mid.players[0].resources.DIL + 2)
		const g = features(bump(mid, 0, res('GLO', 3)), 0)
		expect(g[FEATURE_INDEX['score.total']]).toBe(
			features(mid, 0)[FEATURE_INDEX['score.total']]! + 3,
		)
	})
})

describe('evaluate', () => {
	it('more VP is better; the opponent gaining VP is worse', () => {
		const base = evaluate(mid, 0)
		expect(evaluate(bump(mid, 0, res('GLO', 2)), 0)).toBeCloseTo(base + 2)
		expect(evaluate(bump(mid, 1, res('GLO', 2)), 0)).toBeCloseTo(base - 2)
		// zero-sum: the opponent's view is the mirror
		expect(evaluate(mid, 1)).toBeCloseTo(-base)
	})

	it('gaining a resource or track progress never lowers the value', () => {
		const base = evaluate(mid, 0)
		for (const r of ['DIL', 'LAT', 'GLO'] as const)
			expect(evaluate(bump(mid, 0, res(r, 1)), 0)).toBeGreaterThanOrEqual(base)
		for (const s of ['RESEARCH', 'INFLUENCE', 'MILITARY'] as const) {
			const up = bump(mid, 0, (p) => ({
				...p,
				specialties: {
					...p.specialties,
					[s]: Math.min(15, p.specialties[s] + 1),
				},
			}))
			expect(evaluate(up, 0)).toBeGreaterThanOrEqual(base)
		}
		const team = bump(mid, 0, (p) => ({
			...p,
			awayTeamsInPool: p.awayTeamsInPool + 1,
		}))
		expect(evaluate(team, 0)).toBeGreaterThanOrEqual(base)
	})

	it('a finished game is worth ±WIN_VALUE + the final margin', () => {
		const ended = finalizeGame({
			...bump(mid, 0, res('GLO', 50)),
			result: { kind: 'FINAL_SCORING' },
		})
		expect(ended.result?.kind).toBe('COMPLETE')
		const v0 = evaluate(ended, 0)
		const v1 = evaluate(ended, 1)
		expect(v0).toBeGreaterThan(WIN_VALUE)
		expect(v1).toBeLessThan(-WIN_VALUE)
		expect(v0 + v1).toBeCloseTo(0)
		// an unfinalised trigger is finalised on the fly
		expect(
			evaluate(
				{ ...bump(mid, 0, res('GLO', 50)), result: { kind: 'FINAL_SCORING' } },
				0,
			),
		).toBeCloseTo(v0)
		expect(evaluateNormalized(ended, 0)).toBeLessThanOrEqual(1)
		expect(evaluateNormalized(ended, 0)).toBeGreaterThan(0.99)
		expect(Math.abs(evaluateNormalized(mid, 0))).toBeLessThan(1)
	})
})
