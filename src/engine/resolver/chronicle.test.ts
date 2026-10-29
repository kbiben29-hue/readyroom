// The log lines chronicle.ts writes for events that take something off the
// table: a dismissed card (and what was beamed aboard it), an opponent's
// Away Teams removed. Without them a card left the board with no trace.

import { describe, expect, it } from 'vitest'
import { fresh, ID, makeDef, place, pushAndRun, register } from './testUtils'
import type { GameState, LogEntry } from '../state'

register([
	makeDef({
		id: 'chr-ship',
		suit: 'SHIP',
		traits: ['ROMULAN'],
		operations: [],
	}),
	makeDef({ id: 'chr-person', suit: 'PERSON', operations: [] }),
	makeDef({ id: 'chr-loc', suit: 'LOCATION', operations: [] }),
])

function newEntries(before: GameState, after: GameState): LogEntry[] {
	return after.log.slice(before.log.length)
}

describe('chronicle', () => {
	it("logs a dismissed opponent ship and the card beamed aboard it, as the attacker's lines about the victim", () => {
		let s = fresh()
		s = place(s, 'chr-ship', ID('ship'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'chr-person', ID('crew'), { k: 'BEAMED', host: 'ship' }, 0, {
			beamedTo: ID('ship'),
		})
		const out = pushAndRun(
			s,
			{
				k: 'DISMISS',
				target: {
					zones: ['IN_PLAY'],
					seat: 'OPPONENT',
					filter: { traits: ['ROMULAN'] },
				},
			},
			ID('src'),
			1,
		)
		expect(out.cards['ship']!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		const lines = newEntries(s, out).filter((e) => e.kind === 'EVENT')
		expect(lines).toContainEqual({
			kind: 'EVENT',
			seat: 1,
			message: 'dismissed ship',
			iid: 'ship',
			about: 0,
		})
		expect(lines.map((e) => e.message)).toContain('dismissed crew')
	})

	it("logs an opponent's Away Team removed, but not your own coming home", () => {
		let s = fresh()
		s = place(s, 'chr-loc', ID('loc'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = {
			...s,
			awayTeamsAt: { loc: [1, 1] },
		}
		const theirs = pushAndRun(
			s,
			{
				k: 'REMOVE_AWAY_TEAM',
				count: 1,
				whose: 'OPPONENT',
				target: {
					zones: ['NEUTRAL_LOCATIONS'],
					filter: { suits: ['LOCATION'] },
				},
			},
			ID('src'),
			1,
		)
		expect(theirs.awayTeamsAt['loc']).toEqual([0, 1])
		expect(newEntries(s, theirs)).toContainEqual({
			kind: 'EVENT',
			seat: 1,
			message: 'removed 1 opponent Away Team from [[card:chr-loc]]',
			about: 0,
		})

		const own = pushAndRun(
			s,
			{
				k: 'REMOVE_AWAY_TEAM',
				count: 1,
				whose: 'SELF',
				target: {
					zones: ['NEUTRAL_LOCATIONS'],
					filter: { suits: ['LOCATION'] },
				},
			},
			ID('src'),
			1,
		)
		expect(own.awayTeamsAt['loc']).toEqual([1, 0])
		expect(newEntries(s, own).filter((e) => e.kind === 'EVENT')).toEqual([])
	})

	it('records nothing in probe mode', () => {
		let s = fresh()
		s = place(s, 'chr-ship', ID('ship'), { k: 'FLEET', seat: 0 }, 0)
		const out = pushAndRun(
			{ ...s, probe: true },
			{ k: 'DISMISS', target: { zones: ['IN_PLAY'], seat: 'OPPONENT' } },
			ID('src'),
			1,
		)
		expect(newEntries(s, out).filter((e) => e.kind === 'EVENT')).toEqual([])
	})
})
