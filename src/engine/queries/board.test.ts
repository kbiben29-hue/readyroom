// Board queries (todo/05 §5): tokensAt = Away Teams + Ship tokens; isSecured =
// neutral + ≥3 tokens + ≥2 more than the opponent (rules/03 §3.4.1); and
// canSendAwayTeam blocked iff neutral AND more opponent Ship tokens
// (rules/12 §12.15 — ties and controlled Locations never block).

import { describe, expect, it } from 'vitest'
import { fresh, register, makeDef, place, ID } from '../resolver/testUtils'
import { tokensAt, shipTokensAt, isSecured, canSendAwayTeam } from './board'
import type { GameState } from '../state'
import type { Seat } from '../resolver/queries'
import { assertSerialisable } from '../invariants'

/** A neutral Location plus `mine`/`opp` away teams parked on it, and optional
 *  ship-token counts per seat via ships placed in FLEET. */
function neutralLoc(
	awayMine: number,
	awayOpp: number,
	ships: [mine: number, opp: number] = [0, 0],
): GameState {
	register([
		makeDef({ id: 'loc', suit: 'LOCATION', operations: [] }),
		makeDef({ id: 'shp', suit: 'SHIP', operations: [] }),
	])
	let s = fresh()
	s = place(s, 'loc', ID('L'), { k: 'NEUTRAL_ZONE', slot: 0 }, null)
	s = { ...s, awayTeamsAt: { ...s.awayTeamsAt, L: [awayMine, awayOpp] } }
	for (let i = 0; i < ships[0]!; i++)
		s = place(s, 'shp', ID(`sm${i}`), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('L'),
		})
	for (let i = 0; i < ships[1]!; i++)
		s = place(s, 'shp', ID(`so${i}`), { k: 'FLEET', seat: 1 }, 1, {
			shipTokenAt: ID('L'),
		})
	return s
}

describe('tokensAt (Away Teams + Ship tokens)', () => {
	it('combines away teams and ship tokens for each seat', () => {
		const s = neutralLoc(1, 2, [1, 0])
		assertSerialisable(s)
		expect(tokensAt(s, ID('L'), 0)).toBe(2) // 1 away + 1 ship
		expect(tokensAt(s, ID('L'), 1)).toBe(2) // 2 away
		expect(shipTokensAt(s, ID('L'), 0)).toBe(1)
		expect(shipTokensAt(s, ID('L'), 1)).toBe(0)
	})
})

describe('isSecured (rules/03 §3.4.1)', () => {
	it.each<[mine: number, opp: number, expected: boolean]>([
		[3, 0, true],
		[3, 1, true],
		[3, 2, false],
		[2, 0, false],
		[4, 2, true],
		[4, 3, false],
	])('tokens (%i, %i) → %s', (mine, opp, expected) => {
		const s = neutralLoc(mine, opp)
		expect(isSecured(s, ID('L'), 0)).toBe(expected)
	})

	it('ship tokens count toward security exactly like away teams', () => {
		// 1 away + 2 ships = 3 vs 1 away + 0 ships = 1 → secured (3 ≥ 3, +2)
		const s = neutralLoc(1, 1, [2, 0])
		expect(isSecured(s, ID('L'), 0)).toBe(true)
		// 1 away + 2 ships = 3 vs 1 away + 2 ships = 3 → tie → NOT secured
		const tie = neutralLoc(1, 1, [2, 2])
		expect(isSecured(tie, ID('L'), 0)).toBe(false)
		// 2 away + 2 ships = 4 vs 2 away = 2 → secured (+2)
		const s2 = neutralLoc(2, 2, [2, 0])
		expect(isSecured(s2, ID('L'), 0)).toBe(true)
	})

	it('a controlled Location is never secured (not neutral)', () => {
		let s = neutralLoc(5, 0)
		s = place(s, 'loc', ID('C'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		s = { ...s, awayTeamsAt: { ...s.awayTeamsAt, C: [5, 0] } }
		expect(isSecured(s, ID('C'), 0)).toBe(false)
	})
})

describe('canSendAwayTeam (rules/12 §12.15)', () => {
	it('more opponent Ship tokens blocks; a tie does not', () => {
		const blocked = neutralLoc(0, 0, [1, 2]) // opp 2 > you 1 → blocked
		expect(canSendAwayTeam(blocked, 0, ID('L'))).toBe(false)
		const tied = neutralLoc(0, 0, [2, 2]) // even ships → allowed
		expect(canSendAwayTeam(tied, 0, ID('L'))).toBe(true)
		const ahead = neutralLoc(0, 0, [2, 1]) // you ahead → allowed
		expect(canSendAwayTeam(ahead, 0, ID('L'))).toBe(true)
	})

	it('Away Teams never block — only Ship tokens matter', () => {
		const s = neutralLoc(10, 10, [0, 1]) // you have 10 away teams, opp 1 ship → blocked
		expect(canSendAwayTeam(s, 0, ID('L'))).toBe(false)
	})

	it('a controlled Location is always allowed regardless of ship count', () => {
		let s = neutralLoc(0, 0, [1, 2])
		const loc: GameState['cards'][string] = s.cards.L!
		s = {
			...s,
			cards: {
				...s.cards,
				L: { ...loc, zone: { k: 'LOCATION_AREA', seat: 0 as Seat } },
			},
			zones: {
				...s.zones,
				'LOCATION_AREA:0': [...(s.zones['LOCATION_AREA:0'] ?? []), ID('L')],
			},
		}
		expect(canSendAwayTeam(s, 0, ID('L'))).toBe(true) // controlled → never blocked
	})
})
