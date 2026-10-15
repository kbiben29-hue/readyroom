// Endgame detection & Burn (todo/10 §1–§2, rules/03 §3.1, rules/12 §12.11).
// The Burn is continuous — checkEndgame fires after every primitive — and
// beats a pending Resolution. The three Resolution-turn-budget cases
// (starting player, second player, Burn mid-extra-turns) live in phases.test.ts;
// this file adds the Burn-inventory, final-Stardate and finalisation tests.

import { describe, expect, it } from 'vitest'
import {
	fresh,
	register,
	makeDef,
	place,
	ID,
	pushAndRun,
} from './resolver/testUtils'
import { newGameState } from './state'
import { handoffStardate, gainResource } from './resolver/runtime'
import { checkEndgame, countIncidents } from './endgame'
import { finalizeGame } from './scoring'
import { assertSerialisable } from './invariants'
import { handOffTurn } from './phases'
import type { GameState } from './state'

function incidentDef(): void {
	register([makeDef({ id: 'inc', suit: 'INCIDENT', operations: [] })])
}

describe('The Burn (rules/03 §3.1, rules/12 §12.11)', () => {
	it('fires after a primitive that empties the Incident deck (take the last)', () => {
		incidentDef()
		let s = fresh()
		s = place(s, 'inc', ID('last'), { k: 'INCIDENT_DECK' }, null)
		const out = pushAndRun(
			s,
			{ k: 'TAKE', deck: 'INCIDENT', count: 1 },
			ID('x'),
			0,
		)
		expect(out.result).toEqual({ kind: 'BURN' })
		expect(out.phase).toEqual({ k: 'GAME_OVER' })
	})

	it('counts only hand + discard + draw + log; Reserve excluded (rules/03 §3.1)', () => {
		incidentDef()
		let s = fresh()
		s = place(s, 'inc', ID('a1'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'inc', ID('a2'), { k: 'DISCARD', seat: 0 }, 0)
		s = place(s, 'inc', ID('a3'), { k: 'RESERVE', seat: 0 }, 0) // must NOT count
		s = place(s, 'inc', ID('a4'), { k: 'JUNK' }, null) // not owned
		s = place(s, 'inc', ID('b1'), { k: 'HAND', seat: 1 }, 1)
		s = place(s, 'inc', ID('b2'), { k: 'LOG', seat: 1 }, 1)
		s = place(s, 'inc', ID('b3'), { k: 'DRAW', seat: 1 }, 1)
		expect(countIncidents(s, 0)).toBe(2)
		expect(countIncidents(s, 1)).toBe(3)
	})

	it('fewer INCIDENTs wins; a Reserve INCIDENT does not count', () => {
		incidentDef()
		let s = fresh()
		s = place(s, 'inc', ID('a1'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'inc', ID('a2'), { k: 'DISCARD', seat: 0 }, 0)
		s = place(s, 'inc', ID('a3'), { k: 'RESERVE', seat: 0 }, 0) // excluded → still 2
		s = place(s, 'inc', ID('b1'), { k: 'HAND', seat: 1 }, 1)
		s = place(s, 'inc', ID('b2'), { k: 'LOG', seat: 1 }, 1)
		s = place(s, 'inc', ID('b3'), { k: 'DRAW', seat: 1 }, 1)
		const burned: GameState = { ...s, result: { kind: 'BURN' } }
		const out = finalizeGame(burned)
		assertSerialisable(out)
		if (out.result === null || out.result.kind !== 'COMPLETE')
			throw new Error('expected COMPLETE')
		expect(out.result.scoreboard.incidentCounts).toEqual([2, 3])
		expect(out.result.scoreboard.winners).toEqual([0])
	})

	it('equal counts → falls through to final scoring (Glory breaks the tie)', () => {
		incidentDef()
		let s = fresh()
		s = place(s, 'inc', ID('a1'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'inc', ID('b1'), { k: 'HAND', seat: 1 }, 1)
		s = {
			...s,
			players: s.players.map((pl) =>
				pl.seat === 0 ? { ...pl, resources: { ...pl.resources, GLO: 4 } } : pl,
			) as GameState['players'],
		}
		const burned: GameState = { ...s, result: { kind: 'BURN' } }
		const out = finalizeGame(burned)
		if (out.result === null || out.result.kind !== 'COMPLETE')
			throw new Error('expected COMPLETE')
		expect(out.result.scoreboard.incidentCounts).toEqual([1, 1])
		expect(out.result.scoreboard.winners).toEqual([0]) // 4 Glory > 0
	})

	it('CADET mode: the Burn is a loss (rules/10 §10.2 #5)', () => {
		incidentDef()
		let s = newGameState(1, { mode: 'CADET' })
		s = place(s, 'inc', ID('a1'), { k: 'HAND', seat: 0 }, 0)
		const burned: GameState = { ...s, result: { kind: 'BURN' } }
		const out = finalizeGame(burned)
		if (out.result === null || out.result.kind !== 'COMPLETE')
			throw new Error('expected COMPLETE')
		expect(out.result.scoreboard.cadetLoss).toBe(true)
		expect(out.result.scoreboard.winners).toEqual([])
	})
})

describe('Resolution — final Stardate card (rules/03 §3.6.4, rules/12 §12.9–§12.10)', () => {
	it('emptying the last Stardate card: not handed over, not refilled, stays in place', () => {
		let s = fresh()
		s = { ...s, stardates: { pile: [ID('sd-final')], gloryOnTop: 2 } }
		const out = handoffStardate(s, 0)
		expect(out.resolutionTriggered).toBe(true)
		expect(out.stardates.pile).toEqual([ID('sd-final')]) // stays in place as the marker
		expect(out.stardates.gloryOnTop).toBe(0) // not refilled
		expect(out.players[1].heldStardate).toBeNull() // not handed over
	})

	it('a mid-effect Glory gain that empties the final card triggers Resolution', () => {
		let s = fresh()
		s = { ...s, stardates: { pile: [ID('sd-final')], gloryOnTop: 2 } }
		const out = gainResource(s, 0, 'GLO', 5)
		expect(out.resolutionTriggered).toBe(true)
		expect(out.stardates.pile).toEqual([ID('sd-final')])
		expect(out.players[0].resources.GLO).toBe(5) // remainder comes from the supply
	})

	it('after Resolution, all Glory comes from the supply (already triggered)', () => {
		let s = fresh()
		s = {
			...s,
			resolutionTriggered: true,
			stardates: { pile: [ID('sd-final')], gloryOnTop: 3 },
		}
		const out = gainResource(s, 0, 'GLO', 2)
		expect(out.players[0].resources.GLO).toBe(2)
		expect(out.stardates.gloryOnTop).toBe(3) // untouched
		expect(out.resolutionTriggered).toBe(true)
	})

	it('checkEndgame is a no-op on an uninitialised state (no INCIDENT_DECK zone)', () => {
		const out = checkEndgame(fresh())
		expect(out.result).toBeNull()
	})
})

describe('Stardate exhaustion end-to-end (rules/03 §3.6.4, rules/07 §7.4)', () => {
	it('final card empties → extra turns → final scoring with exact per-seat totals', () => {
		register([
			makeDef({ id: 'g9', suit: 'PERSON', vp: 9, operations: [] }),
			makeDef({ id: 'g4', suit: 'PERSON', vp: 4, operations: [] }),
			makeDef({ id: 'g6', suit: 'PERSON', vp: 6, operations: [] }),
		])
		let s = fresh()
		s = place(s, 'g9', ID('g9'), { k: 'LOG', seat: 0 }, 0)
		s = place(s, 'g4', ID('g4'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'g6', ID('g6'), { k: 'DISCARD', seat: 1 }, 1)
		s = {
			...s,
			players: s.players.map((pl) =>
				pl.seat === 0 ? { ...pl, resources: { ...pl.resources, GLO: 2 } } : pl,
			) as GameState['players'],
		}
		// Stardate exhaustion (last card emptied by a Glory gain) triggers Resolution;
		// the final card stays in place as the marker (rules/03 §3.6.4).
		s = { ...s, stardates: { pile: [ID('sd-final')], gloryOnTop: 0 } }
		s = handoffStardate(s, 0)
		expect(s.resolutionTriggered).toBe(true)
		expect(s.stardates.pile).toEqual([ID('sd-final')])

		// Starting player was mid-turn-1 → budget 3 turn ends (phases.ts, docs §6).
		s = handOffTurn(s, 0) // p0 ends the interrupted turn  → [1,0], budget 3
		s = handOffTurn(s, 1) // p1 finishes the round          → [1,1], budget 2
		s = handOffTurn(s, 0) // p0 extra turn                  → budget 1
		s = handOffTurn(s, 1) // p1 extra turn                  → FINAL_SCORING
		expect(s.result).toEqual({ kind: 'FINAL_SCORING' })
		expect(s.phase.k).toBe('GAME_OVER')

		const out = finalizeGame(s)
		assertSerialisable(out)
		if (out.result === null || out.result.kind !== 'COMPLETE')
			throw new Error('expected COMPLETE')
		const [b0, b1] = out.result.scoreboard.breakdown
		expect(b0.total).toBe(15) // printed 9 + 4 + Glory 2
		expect(b1.total).toBe(6) // printed 6
		expect(out.scoreVp).toEqual({ 0: 15, 1: 6 })
		expect(out.result.scoreboard.winners).toEqual([0])
	})
})

describe('real 2-PLAYER Stardate track (SD01–SD05, rules/02 §2.1 #11/#13)', () => {
	it('seeds 5, refills 7/7/6/5 on each handoff, and the 5th empty triggers the Resolution', async () => {
		const { loadCatalog } = await import('../data/catalog')
		const { setup } = await import('./setup')
		const catalog = await loadCatalog()
		let s = setup(
			{
				mode: 'TWO_PLAYER',
				players: [
					{ deck: 'PIC', boardSide: 'BASIC' },
					{ deck: 'SHR', boardSide: 'BASIC' },
				],
				seed: 7,
			},
			catalog,
		)
		const defOf = (iid: string) => s.cards[iid]!.def
		expect(s.stardates.pile.map(defOf)).toEqual([
			'sd-01',
			'sd-02',
			'sd-03',
			'sd-04',
			'sd-05',
		])
		expect(s.stardates.gloryOnTop).toBe(5)
		let total = s.stardates.gloryOnTop
		const refills: number[] = []
		for (let i = 0; i < 4; i++) {
			s = handoffStardate(s, 0)
			refills.push(s.stardates.gloryOnTop)
			total += s.stardates.gloryOnTop
			// the emptied card goes to the inactive player, resolved in their Clean-up
			expect(s.players[1].heldStardate).not.toBeNull()
			expect(s.resolutionTriggered).toBe(false)
		}
		expect(refills).toEqual([7, 7, 6, 5]) // #4 holds 6 (rulebook p.12 example)
		expect(total).toBe(30) // "30 total Glory placed on the Stardate cards"
		expect(s.stardates.pile.map(defOf)).toEqual(['sd-05'])
		s = handoffStardate(s, 0)
		expect(s.resolutionTriggered).toBe(true)
		expect(s.stardates.pile.map(defOf)).toEqual(['sd-05']) // stays, not handed over
	})
})
