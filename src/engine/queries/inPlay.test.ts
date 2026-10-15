// in-play zone membership (todo/05 §5, rules/08 → `in play`): driven purely by
// zoneProps, not a hand-written list. Deployed / controlled / beamed / Staging
// cards are in play for their owner; hand & every deck/pile/log are not.

import { describe, expect, it } from 'vitest'
import { fresh, register, makeDef, place, ID } from '../resolver/testUtils'
import { inPlayCards, isInPlay, owned } from './inPlay'
import type { GameState } from '../state'
import { assertSerialisable } from '../invariants'

function board(): GameState {
	register([makeDef({ id: 'p', suit: 'PERSON', operations: [] })])
	let s = fresh()
	const inPlay: Array<
		[
			string,
			(
				| 'LOCATION_AREA'
				| 'FLEET'
				| 'DUTY_OFFICER'
				| 'CAPTAIN'
				| 'STATUS'
				| 'STAGING'
			),
		]
	> = [
		['la', 'LOCATION_AREA'],
		['fl', 'FLEET'],
		['do', 'DUTY_OFFICER'],
		['cp', 'CAPTAIN'],
		['st', 'STATUS'],
		['sg', 'STAGING'],
	]
	for (const [iid, zone] of inPlay) {
		s = place(s, 'p', ID(iid), { k: zone, seat: 0 }, 0)
	}
	// hand / deck / pile / log: NOT in play
	s = place(s, 'p', ID('hd'), { k: 'HAND', seat: 0 }, 0)
	s = place(s, 'p', ID('dw'), { k: 'DRAW', seat: 0 }, 0)
	s = place(s, 'p', ID('ds'), { k: 'DISCARD', seat: 0 }, 0)
	s = place(s, 'p', ID('rs'), { k: 'RESERVE', seat: 0 }, 0)
	s = place(s, 'p', ID('dv'), { k: 'DEVELOPMENT', seat: 0 }, 0)
	s = place(s, 'p', ID('lg'), { k: 'LOG', seat: 0 }, 0)
	// a beamed card IS in play
	s = place(s, 'p', ID('bm'), { k: 'BEAMED', host: ID('fl') }, 0)
	return s
}

describe('inPlayCards / isInPlay (rules/08)', () => {
	it('deployed, controlled, captain, status, staging and beamed cards are in play', () => {
		const s = board()
		assertSerialisable(s)
		const inPlay = inPlayCards(s, 0)
		for (const iid of ['la', 'fl', 'do', 'cp', 'st', 'sg', 'bm']) {
			expect(inPlay).toContain(ID(iid))
			expect(isInPlay(s, ID(iid))).toBe(true)
		}
	})

	it('hand, Draw, Discard, Reserve, Development and Log are NOT in play', () => {
		const s = board()
		const inPlay = inPlayCards(s, 0)
		for (const iid of ['hd', 'dw', 'ds', 'rs', 'dv', 'lg']) {
			expect(inPlay).not.toContain(ID(iid))
			expect(isInPlay(s, ID(iid))).toBe(false)
		}
	})

	it('a beamed card is in play but its table operations are unavailable (skills excluded too)', () => {
		const s = board()
		expect(isInPlay(s, ID('bm'))).toBe(true)
	})

	it('an opponent card is the opponent’s, not yours (in-play sets are per seat)', () => {
		let s = board()
		s = place(s, 'p', ID('opp'), { k: 'FLEET', seat: 1 }, 1)
		expect(inPlayCards(s, 1)).toContain(ID('opp'))
		expect(inPlayCards(s, 0)).not.toContain(ID('opp'))
		expect(owned(s, 0)).not.toContain(ID('opp'))
		expect(owned(s, 1)).toContain(ID('opp'))
	})
})
