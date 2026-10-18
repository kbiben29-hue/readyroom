// Learned value (house AI, todo/15 §4, docs/bot.md "Learned value"): the
// forward pass, the hash checks that make stale weights fall back, the
// loader's shape checks, and the Hard level's choice of leaf.

import { beforeAll, describe, expect, it } from 'vitest'

import { loadCatalog } from '../data/catalog'
import { cardDataHash } from '../data/cardDataHash'
import type { CardCatalog } from '../engine/setup'
import { setup } from '../engine/setup'
import type { GameState } from '../engine/state'
import { legalIntents } from '../engine/intents'
import { autoPlay } from './autoPlay'
import {
	EVAL_SCALE,
	evaluateFeatures,
	features,
	FEATURE_INDEX,
	FEATURE_NAMES,
} from './evaluate'
import {
	compatibleValue,
	featureHash,
	incompatibility,
	inputColumns,
	INPUT_CLIP,
	loadValue,
	valueOfFeatures,
	weightsProblem,
	type ValueWeights,
} from './learned'
import { BUNDLED_VALUE, hardValue } from './bundledValue'
import { makeBot } from './index'
import { candidates } from './candidates'

let catalog: CardCatalog
let hash: string
let mid: GameState

beforeAll(async () => {
	catalog = await loadCatalog()
	hash = cardDataHash(catalog)
	const start = setup(
		{
			mode: 'TWO_PLAYER',
			players: [
				{ deck: 'PIC', boardSide: 'ADVANCED' },
				{ deck: 'SHR', boardSide: 'ADVANCED' },
			],
			seed: 11,
		},
		catalog,
	)
	// a mid-game decision with several candidates
	let found: GameState | undefined
	autoPlay(start, undefined, 400, (s, _i, step) => {
		if (
			found === undefined &&
			step > 60 &&
			s.pendingChoice === null &&
			s.result === null &&
			candidates(s, s.activeSeat, legalIntents(s)).length >= 4
		)
			found = s
	})
	mid = found!
})

/** Tiny hand-made weights over the diff-masked layout: two hidden units. */
function tinyWeights(over: Partial<ValueWeights> = {}): ValueWeights {
	const cols = inputColumns('diff-masked')
	const n = cols.length
	const at = (name: string) => cols.findIndex((c) => c.name === name)
	const row = (entries: [string, number][]) => {
		const r = new Array<number>(n).fill(0)
		for (const [name, v] of entries) r[at(name)] = v
		return r
	}
	return {
		format: 1,
		layout: 'diff-masked',
		featureHash: featureHash('diff-masked'),
		cardDataHash: hash,
		featureNames: cols.map((c) => c.name),
		norm: {
			mean: new Array<number>(n).fill(0),
			std: cols.map((c) => (c.name === 'turn.number' ? 2 : 1)),
		},
		layers: [
			{
				w: [
					row([['d.score.total', 0.1]]),
					row([
						['turn.number', -0.2],
						['me.hand.value', 0.3],
					]),
				],
				b: [0.05, 0],
			},
			{ w: [[1, 0.5]], b: [0.1] },
		],
		meta: {
			trainedOn: 'test',
			games: 0,
			valLoss: 0,
			signAccuracy: 0,
			baselineSignAccuracy: 0,
			gate: {
				vs: 'test',
				games: 0,
				winRate: 1,
				ci: [1, 1],
				passed: true,
			},
		},
		...over,
	}
}

function vec(values: Partial<Record<(typeof FEATURE_NAMES)[number], number>>) {
	const f = new Array<number>(FEATURE_NAMES.length).fill(0)
	for (const [k, v] of Object.entries(values))
		f[FEATURE_INDEX[k as (typeof FEATURE_NAMES)[number]]] = v
	return f
}

describe('learned value: forward pass', () => {
	it('computes tanh layers over standardised, clipped inputs', () => {
		const value = valueOfFeatures(tinyWeights())
		const mine = vec({ 'score.total': 7, 'turn.number': 6, 'hand.value': 2 })
		const theirs = vec({ 'score.total': 4, 'turn.number': 6, 'hand.value': 9 })
		const h0 = Math.tanh(0.05 + 0.1 * (7 - 4))
		// turn.number is standardised by std 2; the opponent's hand.value is
		// masked out of the layout, only the own one is an input
		const h1 = Math.tanh(-0.2 * (6 / 2) + 0.3 * 2)
		expect(value(mine, theirs)).toBeCloseTo(Math.tanh(0.1 + h0 + 0.5 * h1), 12)
	})

	it('clips a standardised input at ±INPUT_CLIP', () => {
		const value = valueOfFeatures(tinyWeights())
		const big = value(vec({ 'score.total': 1000 }), vec({}))
		const h0 = Math.tanh(0.05 + 0.1 * INPUT_CLIP)
		expect(big).toBeCloseTo(Math.tanh(0.1 + h0 + 0.5 * Math.tanh(0)), 12)
	})

	it('loadValue scores a state from the two seats’ features, in [−1, 1]', () => {
		const w = tinyWeights()
		const fn = loadValue(w)
		const fromFeatures = valueOfFeatures(w)
		for (const seat of [0, 1] as const) {
			const v = fn(mid, seat)
			expect(v).toBeGreaterThanOrEqual(-1)
			expect(v).toBeLessThanOrEqual(1)
			expect(v).toBe(
				fromFeatures(features(mid, seat), features(mid, (1 - seat) as 0 | 1)),
			)
		}
	})

	it('evalMix blends in the hand-tuned evaluation', () => {
		const mine = features(mid, 0)
		const theirs = features(mid, 1)
		const hand = Math.tanh(evaluateFeatures(mine, theirs) / EVAL_SCALE)
		const net = valueOfFeatures(tinyWeights())(mine, theirs)
		expect(
			valueOfFeatures(tinyWeights({ evalMix: 1 }))(mine, theirs),
		).toBeCloseTo(hand, 12)
		expect(
			valueOfFeatures(tinyWeights({ evalMix: 0.25 }))(mine, theirs),
		).toBeCloseTo(0.75 * net + 0.25 * hand, 12)
		expect(weightsProblem(tinyWeights({ evalMix: 2 }))).toMatch(/evalMix/)
	})

	it('the input layouts have unique column names and distinct hashes', () => {
		const hashes = new Set<string>()
		for (const layout of [
			'pair',
			'pair-masked',
			'diff',
			'diff-masked',
		] as const) {
			const names = inputColumns(layout).map((c) => c.name)
			expect(new Set(names).size).toBe(names.length)
			hashes.add(featureHash(layout))
		}
		expect(hashes.size).toBe(4)
		expect(inputColumns('pair-masked').map((c) => c.name)).not.toContain(
			'opp.hand.value',
		)
	})
})

describe('learned value: compatibility', () => {
	it('accepts weights with matching hashes', () => {
		expect(incompatibility(tinyWeights(), catalog)).toBeNull()
		expect(compatibleValue(tinyWeights(), hash)).toBeTypeOf('function')
	})

	it('returns null on a card-data hash mismatch', () => {
		expect(
			compatibleValue(
				tinyWeights({ cardDataHash: '0000000000000000' }),
				catalog,
			),
		).toBeNull()
		expect(compatibleValue(tinyWeights(), 'ffffffffffffffff')).toBeNull()
	})

	it('returns null on a feature hash mismatch (features changed)', () => {
		expect(
			compatibleValue(
				tinyWeights({ featureHash: featureHash('pair') }),
				catalog,
			),
		).toBeNull()
	})

	it('rejects a wrong layout or shape', () => {
		const w = tinyWeights()
		expect(weightsProblem(w)).toBeNull()
		expect(weightsProblem({ ...w, layout: 'nope' })).toMatch(/layout/)
		expect(
			weightsProblem({ ...w, featureNames: w.featureNames.slice(1) }),
		).toMatch(/featureNames/)
		expect(weightsProblem({ ...w, layout: 'pair' })).toMatch(/featureNames/)
		const short = structuredClone(w)
		short.layers[0]!.w[1] = short.layers[0]!.w[1]!.slice(1)
		expect(weightsProblem(short)).toMatch(/inputs/)
		const twoOut = structuredClone(w)
		twoOut.layers[1] = {
			w: [
				[1, 0.5],
				[0, 1],
			],
			b: [0, 0],
		}
		expect(weightsProblem(twoOut)).toMatch(/one output/)
		expect(weightsProblem({ ...w, format: 2 })).toMatch(/format/)
		expect(() => loadValue(short)).toThrow(/value weights/)
		expect(compatibleValue(short, catalog)).toBeNull()
		expect(compatibleValue({ format: 0 }, catalog)).toBeNull()
	})
})

describe('the Hard level picks its leaf', () => {
	it('uses the learned value only with matching card data and a passed gate', () => {
		expect(hardValue(catalog, tinyWeights())).toBeTypeOf('function')
		expect(hardValue(undefined, tinyWeights())).toBeUndefined()
		expect(
			hardValue(catalog, tinyWeights({ cardDataHash: '0000000000000000' })),
		).toBeUndefined()
		expect(
			hardValue(catalog, tinyWeights({ featureHash: 'x' })),
		).toBeUndefined()
		const notGated = tinyWeights()
		notGated.meta.gate = { ...notGated.meta.gate!, passed: false }
		expect(hardValue(catalog, notGated)).toBeUndefined()
		// the bundled file is either compatible + gated or ignored, never a crash
		expect(() => hardValue(catalog, BUNDLED_VALUE)).not.toThrow()
	})

	it('makeBot("hard") with incompatible weights plays exactly the hand-tuned search', () => {
		const legal = legalIntents(mid)
		const seat = mid.activeSeat
		const stale = makeBot('hard', {
			cardData: catalog,
			valueWeights: tinyWeights({ cardDataHash: '0000000000000000' }),
		})
		const handTuned = makeBot('hard', { valueWeights: null })
		expect(stale.decide(mid, seat, legal)).toEqual(
			handTuned.decide(mid, seat, legal),
		)
	})
})
