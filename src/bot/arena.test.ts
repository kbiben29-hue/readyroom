// Arena core (src/bot/arena.ts): stats helpers, the schedule, and a smoke
// match set of normal vs first-legal with seat swaps.

import { beforeAll, describe, expect, it } from 'vitest'

import { loadCatalog } from '../data/catalog'
import type { CardCatalog } from '../engine/setup'
import { replay } from '../session/log'
import {
	allPairings,
	deriveSeed,
	mean,
	parsePairings,
	pairingKey,
	playMatch,
	quantile,
	scheduleGame,
	stdErr,
	summarize,
	tally,
	wilson,
	type MatchResult,
} from './arena'
import { botFromSpec, parseBotSpec, BOT_FACTORIES } from './registry'
import { makeBot } from './index'

describe('arena stats', () => {
	it('wilson matches the textbook interval', () => {
		// 8/10 at 95 %: [0.4902, 0.9433]
		const w = wilson(8, 10)
		expect(w.p).toBeCloseTo(0.8, 10)
		expect(w.lo).toBeCloseTo(0.4902, 3)
		expect(w.hi).toBeCloseTo(0.9433, 3)
		// 0/20 and 20/20 stay inside [0, 1] and are not degenerate
		expect(wilson(0, 20).lo).toBe(0)
		expect(wilson(0, 20).hi).toBeCloseTo(0.1611, 3)
		expect(wilson(20, 20).hi).toBe(1)
		expect(wilson(20, 20).lo).toBeCloseTo(0.8389, 3)
		// 50/100
		expect(wilson(50, 100).lo).toBeCloseTo(0.4038, 3)
		expect(wilson(50, 100).hi).toBeCloseTo(0.5962, 3)
		expect(wilson(0, 0)).toEqual({ p: NaN, lo: 0, hi: 1 })
	})

	it('mean, standard error and quantiles', () => {
		expect(mean([1, 2, 3, 4])).toBe(2.5)
		expect(Number.isNaN(mean([]))).toBe(true)
		// sd of [2,4,4,4,5,5,7,9] (sample) = 2.138; se = sd/√8
		expect(stdErr([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(
			2.138 / Math.sqrt(8),
			3,
		)
		expect(Number.isNaN(stdErr([1]))).toBe(true)
		expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1, 10)
		expect(quantile([5], 0.9)).toBe(5)
		expect(quantile([3, 1, 2], 0)).toBe(1)
		expect(quantile([3, 1, 2], 1)).toBe(3)
	})

	it('tally counts a draw as half a win', () => {
		const r = (winner: MatchResult['winner'], margin: number) =>
			({ winner, margin, intents: 100, burn: false }) as MatchResult
		const t = tally([r('A', 5), r('B', -3), r('draw', 0), r(null, 0)])
		expect(t.games).toBe(4)
		expect(t.finished).toBe(3)
		expect([t.aWins, t.bWins, t.draws]).toEqual([1, 1, 1])
		expect(t.aRate.p).toBeCloseTo(0.5, 10)
		expect(t.marginMean).toBeCloseTo(2 / 3, 10)
	})
})

describe('arena schedule', () => {
	it('covers the 72 ordered fuzz pairings and parses lists', () => {
		const all = allPairings()
		expect(all).toHaveLength(72)
		expect(new Set(all.map(pairingKey)).size).toBe(72)
		expect(parsePairings('nobur')).toHaveLength(56)
		const [p] = parsePairings('PIC.B-SHR')
		expect(p).toEqual({ decks: ['PIC', 'SHR'], sides: ['BASIC', 'ADVANCED'] })
		expect(pairingKey(p!)).toBe('PIC.B-SHR')
		expect(() => parsePairings('PIC-PIC')).toThrow()
		expect(() => parsePairings('PIC-XYZ')).toThrow()
	})

	it('pairs a game with its seat-swapped twin on the same setup', () => {
		const ps = allPairings()
		const g0 = scheduleGame(0, 7, ps)
		const g1 = scheduleGame(1, 7, ps)
		const g2 = scheduleGame(2, 7, ps)
		expect(g0.swap).toBe(false)
		expect(g1.swap).toBe(true)
		expect(g1.seed).toBe(g0.seed)
		expect(g1.pairing).toBe(g0.pairing)
		expect(g2.pairing).toBe(ps[1])
		expect(g2.seed).not.toBe(g0.seed)
		expect(deriveSeed(1, 0)).not.toBe(deriveSeed(2, 0))
		expect(deriveSeed(1, 0)).toBe(deriveSeed(1, 0))
	})
})

describe('bot registry', () => {
	it('parses specs and builds bots', () => {
		expect(parseBotSpec('heuristic:samples=4,noise=0.5')).toEqual({
			name: 'heuristic',
			params: { samples: '4', noise: '0.5' },
		})
		expect(botFromSpec('normal').id).toBe('normal')
		expect(botFromSpec('heuristic:samples=1,w.loc.secured=2').id).toBe('normal')
		expect(() => botFromSpec('nope')).toThrow(/unknown bot/)
		expect(() => botFromSpec('heuristic:samples=x')).toThrow()
		expect(() => botFromSpec('heuristic:w.nope=1')).toThrow()
		expect(Object.keys(BOT_FACTORIES)).toEqual(
			expect.arrayContaining(['first-legal', 'easy', 'normal', 'hard']),
		)
	})
})

let catalog: CardCatalog
beforeAll(async () => {
	catalog = await loadCatalog()
})

describe('arena smoke (normal vs first-legal)', () => {
	it('4 seat-swapped games all finish, normal wins ≥ 3, labels follow the swap', () => {
		const normal = makeBot('normal')
		const first = makeBot('first-legal')
		const pairings = parsePairings('PIC-SHR,KOL-SIS')
		const results: MatchResult[] = []
		for (let i = 0; i < 4; i++) {
			const g = scheduleGame(i, 1, pairings)
			results.push(
				playMatch(catalog, g.pairing, g.seed, normal, first, g.swap, {
					recordEvery: 25,
					session: { now: () => new Date('2026-01-01T00:00:00Z') },
				}),
			)
		}
		for (const r of results) {
			expect(r.stopped, r.game).toBe('GAME_OVER')
			expect(r.aSeat).toBe(r.swap ? 1 : 0)
			expect(r.fallbacks).toEqual({ A: 0, B: 0 })
			// the session replays to the same final score, seat for seat
			const s = r.session!
			expect(s.log).toHaveLength(r.intents)
			const end = replay(s, catalog)
			expect(end.result?.kind).toBe('COMPLETE')
			if (end.result?.kind !== 'COMPLETE') continue
			const board = end.result.scoreboard
			expect(board.breakdown[r.aSeat].total).toBe(r.vp.A)
			expect(board.breakdown[1 - r.aSeat]!.total).toBe(r.vp.B)
			const aWon = board.winners.length === 1 && board.winners[0] === r.aSeat
			expect(r.winner === 'A').toBe(aWon)
			expect(r.margin).toBe(r.vp.A - r.vp.B)
			// records: outcome and margin from the deciding seat's side
			expect(r.records!.length).toBeGreaterThan(0)
			for (const rec of r.records!) {
				const mine = rec.seat === r.aSeat ? 'A' : 'B'
				expect(rec.outcome).toBe(
					r.winner === 'draw' ? 0 : r.winner === mine ? 1 : -1,
				)
				expect(rec.margin).toBe(mine === 'A' ? r.margin : -r.margin)
				expect(rec.features).toHaveLength(rec.opp.length)
			}
			// normal's decisions are timed under A, first-legal's under B
			expect(r.decisionMs.A.length).toBeGreaterThan(0)
			expect(r.decisionMs.B.length).toBeGreaterThan(0)
		}
		const s = summarize('normal', 'first-legal', results)
		expect(s.total.aWins).toBeGreaterThanOrEqual(3)
		expect(s.abnormal).toEqual([])
		expect(s.timing.A.fallbacks + s.timing.B.fallbacks).toBe(0)
		expect(Object.keys(s.byPairing)).toEqual(['PIC-SHR', 'KOL-SIS'])
		// the swapped twin replays the same setup with the bots exchanged
		expect(results[1]!.session!.setup).toEqual(results[0]!.session!.setup)
	}, 60_000)
})
