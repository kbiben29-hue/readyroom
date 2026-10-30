// The end screen's headline (todo/10): it names the winner and says why —
// points, the Burn's Incident count, a tie, or the Cadet Training band.

import { describe, expect, it } from 'vitest'
import { endHeadline, endSeatNames } from './EndScreen'
import type { FinalScoreboard, ScoreBreakdown } from '../engine/scoring'

function breakdown(total: number): ScoreBreakdown {
	return {
		total,
		glory: total,
		neutralTokens: { count: 0, vp: 0 },
		endgame: [],
		printedVp: [],
		focus: [],
		missions: [],
		missionsCompleted: 0,
		focusSuppressed: true,
	}
}

function board(
	totals: [number, number],
	extra: Partial<FinalScoreboard> = {},
): FinalScoreboard {
	return {
		breakdown: [breakdown(totals[0]), breakdown(totals[1])],
		winners: totals[0] > totals[1] ? [0] : totals[1] > totals[0] ? [1] : [0, 1],
		cadetLoss: false,
		...extra,
	}
}

describe('endHeadline', () => {
	it('names the winner and the margin', () => {
		expect(
			endHeadline(board([43, 20]), false, ['You', 'House AI (Easy)']),
		).toEqual({
			tone: 'seat-0',
			title: 'You win',
			reason: '43 – 20 VP · won by 23',
		})
		expect(
			endHeadline(board([30, 41]), false, ['Player 1', 'Player 2']),
		).toMatchObject({
			tone: 'seat-1',
			title: 'Player 2 wins',
			reason: '41 – 30 VP · won by 11',
		})
	})

	it('a Burn win says it was the Incidents, not the points', () => {
		const b = board([50, 20], { winners: [1], incidentCounts: [5, 3] })
		expect(endHeadline(b, false, ['Player 1', 'Player 2'])).toMatchObject({
			tone: 'seat-1',
			title: 'Player 2 wins',
			reason: 'The Burn · fewer Incidents: 3 to 5',
		})
	})

	it('a Burn tied on Incidents falls back to points', () => {
		const b = board([31, 28], { incidentCounts: [4, 4] })
		expect(endHeadline(b, false, ['You', 'Player 2']).reason).toBe(
			'The Burn · Incidents tied 4–4, decided on points: 31 – 28 VP',
		)
	})

	it('a tie: both players win', () => {
		expect(
			endHeadline(board([33, 33]), false, ['Player 1', 'Player 2']),
		).toEqual({
			tone: 'tie',
			title: 'Tie: both players win',
			reason: '33 – 33 VP',
		})
	})

	it('Cadet Training: the benchmark band, or the Burn as a loss', () => {
		expect(
			endHeadline(board([105, 0]), true, ['You', 'Player 2']),
		).toMatchObject({
			tone: 'seat-0',
			title: 'Proficient',
		})
		expect(endHeadline(board([40, 0]), true, ['You', 'Player 2']).title).toBe(
			'Keep training',
		)
		const lost = board([90, 0], { winners: [], cadetLoss: true })
		expect(endHeadline(lost, true, ['You', 'Player 2'])).toMatchObject({
			tone: 'alert',
			title: 'Training failed',
		})
	})
})

describe('endSeatNames', () => {
	it('hot-seat: Player 1 / Player 2', () => {
		expect(
			endSeatNames({ opponents: undefined, online: null, viewer: 1 }),
		).toEqual(['Player 1', 'Player 2'])
	})

	it('against the House AI: You and its level', () => {
		expect(
			endSeatNames({ opponents: { 1: 'easy' }, online: null, viewer: 0 }),
		).toEqual(['You', 'House AI (Easy)'])
	})

	it('two AIs of one level are told apart by seat', () => {
		expect(
			endSeatNames({
				opponents: { 0: 'hard', 1: 'hard' },
				online: null,
				viewer: 0,
			}),
		).toEqual(['Player 1 (Hard)', 'Player 2 (Hard)'])
	})

	it('online: You and the other seat’s name', () => {
		expect(
			endSeatNames({ opponents: undefined, online: [null, 'Sam'], viewer: 0 }),
		).toEqual(['You', 'Sam'])
		expect(
			endSeatNames({
				opponents: undefined,
				online: [undefined, null],
				viewer: 1,
			}),
		).toEqual(['Player 1', 'You'])
	})
})
