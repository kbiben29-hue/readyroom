// Explained decisions (src/bot/explain.ts, the UI's AI move ticker):
// `decideExplained` answers exactly what `decide` answers (determinism and the
// arena are unchanged), and its DecisionInfo is plain JSON with the chosen
// option marked among the top few, best first.

import { beforeAll, describe, expect, it } from 'vitest'

import { loadCatalog } from '../data/catalog'
import type { CardCatalog, SetupConfig } from '../engine/setup'
import { setup } from '../engine/setup'
import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import { legalIntents } from '../engine/intents'
import type { Seat } from '../engine/resolver/queries'
import { decisionSeat } from '../session/interrupts'
import { autoPlay } from './autoPlay'
import { candidates } from './candidates'
import {
	explainDecision,
	marginOfValue,
	MAX_OPTIONS,
	NOTE_FIRST_LEGAL,
	NOTE_FORCED,
	topOptions,
	type DecisionInfo,
} from './explain'
import { firstLegalBot, makeBot } from './index'
import { makeIsmctsBot } from './ismcts'
import type { Bot } from './types'

let catalog: CardCatalog

beforeAll(async () => {
	catalog = await loadCatalog()
})

function config(seed: number): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: 'PIC', boardSide: 'ADVANCED' },
			{ deck: 'SHR', boardSide: 'ADVANCED' },
		],
		seed,
	}
}

/** Decisions along a first-legal game: a few top-level Action Step ones with
 *  several candidates, and a few pending choices. */
function decisions(seed: number): { state: GameState; seat: Seat }[] {
	const action: { state: GameState; seat: Seat }[] = []
	const choice: { state: GameState; seat: Seat }[] = []
	autoPlay(setup(config(seed), catalog), undefined, 600, (s) => {
		if (s.result !== null) return
		const seat = decisionSeat(s)
		if (seat === null) return
		const n = candidates(s, seat, legalIntents(s)).length
		if (n < 2) return
		if (s.pendingChoice !== null) {
			if (choice.length < 3) choice.push({ state: s, seat })
		} else if (s.phase.k === 'ACTION' && action.length < 4)
			action.push({ state: s, seat })
	})
	return [...action.filter((_, i) => i % 2 === 1), ...choice]
}

function checkInfo(info: DecisionInfo, intent: Intent, bot: Bot): void {
	expect(info.botId).toBe(bot.id)
	expect(JSON.parse(JSON.stringify(info))).toEqual(info)
	expect(info.options.length).toBeLessThanOrEqual(MAX_OPTIONS)
	if (info.kind === 'forced' || info.kind === 'rule') {
		expect(info.note).toBeTruthy()
		return
	}
	const chosen = info.options.filter((o) => o.chosen)
	expect(chosen).toHaveLength(1)
	expect(chosen[0]!.intent).toEqual(intent)
	for (const o of info.options) expect(Number.isFinite(o.score)).toBe(true)
}

describe('decideExplained', () => {
	it('returns the same intent as decide (heuristic levels)', () => {
		const states = decisions(3)
		expect(states.length).toBeGreaterThanOrEqual(4)
		for (const id of ['normal', 'easy'] as const) {
			const bot = makeBot(id)
			for (const { state, seat } of states) {
				const legal = legalIntents(state)
				const before = JSON.stringify(state)
				const plain = bot.decide(state, seat, legal)
				const explained = bot.decideExplained!(state, seat, legal)
				expect(explained.intent).toEqual(plain)
				expect(JSON.stringify(state)).toBe(before)
				checkInfo(explained.info, plain, bot)
				if (explained.info.kind === 'heuristic') {
					const scores = explained.info.options.map((o) => o.score)
					// best first (Easy may pick a lower one, kept in the list)
					expect(scores[0]).toBe(Math.max(...scores))
				}
			}
		}
	})

	it('returns the same intent as decide (ISMCTS), with visit shares', () => {
		const bot = makeIsmctsBot({ iterations: 40 })
		let searched = 0
		for (const { state, seat } of decisions(5)) {
			const legal = legalIntents(state)
			const plain = bot.decide(state, seat, legal)
			const explained = bot.decideExplained!(state, seat, legal)
			expect(explained.intent).toEqual(plain)
			checkInfo(explained.info, plain, bot)
			if (explained.info.kind !== 'search') continue
			searched++
			expect(explained.info.iterations).toBe(40)
			const shares = explained.info.options.map((o) => o.share ?? 0)
			expect(shares.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1 + 1e-9)
			// the most visited option is the move played
			expect(explained.info.options[0]!.chosen).toBe(true)
			expect(shares[0]).toBe(Math.max(...shares))
		}
		expect(searched).toBeGreaterThan(0)
	}, 30_000)

	it('the Hard level answers the same with and without explaining', () => {
		const bot = makeBot('hard')
		const { state, seat } = decisions(3)[0]!
		const legal = legalIntents(state)
		expect(bot.decideExplained!(state, seat, legal).intent).toEqual(
			bot.decide(state, seat, legal),
		)
	}, 30_000)

	it('a forced decision says so; first-legal is a rule', () => {
		const s = setup(config(3), catalog)
		const legal = legalIntents(s) // START only
		expect(legal).toHaveLength(1)
		const normal = makeBot('normal').decideExplained!(s, 0, legal)
		expect(normal.info).toMatchObject({ kind: 'forced', note: NOTE_FORCED })
		expect(normal.info.options).toEqual([])
		const { state, seat } = decisions(3)[0]!
		const fl = explainDecision(firstLegalBot, state, seat, legalIntents(state))
		expect(fl.intent).toEqual(
			firstLegalBot.decide(state, seat, legalIntents(state)),
		)
		expect(fl.info).toMatchObject({ kind: 'rule', note: NOTE_FIRST_LEGAL })
	})
})

describe('explain helpers', () => {
	it('topOptions keeps the chosen option among the top few', () => {
		const rows = [1, 5, 3, 4, 2, 0].map((score, i) => ({
			intent: { t: 'PASS' } as Intent,
			score,
			chosen: i === 5,
		}))
		const top = topOptions(rows, (o) => o.score, 3)
		expect(top.map((o) => o.score)).toEqual([5, 4, 0])
		expect(top[2]!.chosen).toBe(true)
	})

	it('marginOfValue inverts the tanh squash and stays finite', () => {
		expect(marginOfValue(Math.tanh(3 / 15), 15)).toBeCloseTo(3, 6)
		expect(Number.isFinite(marginOfValue(1, 15))).toBe(true)
		expect(marginOfValue(Number.NEGATIVE_INFINITY, 15)).toBe(0)
	})
})
