// moveCard is the single sanctioned zone mutator (todo/05 §3). It owns every
// cascade rule so no primitive re-implements them:
//   - beamed children travel with a leaving-play host (rules/12 §12.6);
//   - dismissing the *beamed card* leaves the host untouched;
//   - a SHIP leaving play sends its token to the supply (never back onto the
//     card — only DEPLOY puts it there; rules/12 §12.16, todo/08 §7);
//   - a LOCATION leaving play dismisses its Ships and returns Away Teams to
//     the owners' Captain cards (rules/08 → log / destroy / take control);
//   - rule modifiers detach when their source leaves play (data-model §7).

import { describe, expect, it } from 'vitest'
import { fresh, register, makeDef, place, ID } from './resolver/testUtils'
import { moveCard, type GameState } from './state'
import { assertSerialisable } from './invariants'
import type { CardInstanceId } from './ids'

function shipState(): GameState {
	register([
		makeDef({ id: 'shp', suit: 'SHIP', operations: [] }),
		makeDef({ id: 'crew', suit: 'PERSON', operations: [] }),
		makeDef({ id: 'loc', suit: 'LOCATION', operations: [] }),
	])
	// ship deployed in FLEET with its token parked at a neutral Location
	let s = fresh()
	s = place(s, 'loc', ID('L'), { k: 'NEUTRAL_ZONE', slot: 0 }, null)
	s = place(s, 'shp', ID('S'), { k: 'FLEET', seat: 0 }, 0, {
		shipTokenAt: ID('L'),
	})
	s = { ...s, awayTeamsAt: { ...s.awayTeamsAt, L: [0, 0] } }
	return s
}

const beamOnto = (
	state: GameState,
	child: CardInstanceId,
	host: CardInstanceId,
): GameState => {
	const card = state.cards[child]!
	return {
		...state,
		cards: {
			...state.cards,
			[child]: { ...card, zone: { k: 'BEAMED', host }, beamedTo: host },
		},
		zones: {
			...state.zones,
			[`BEAMED:${host}`]: [...(state.zones[`BEAMED:${host}`] ?? []), child],
		},
	}
}

describe('moveCard cascades (todo/05 §3)', () => {
	it('beam 2 to a SHIP, dismiss the SHIP → all 3 in Discard, token in the supply', () => {
		let s = shipState()
		s = place(s, 'crew', ID('c1'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'crew', ID('c2'), { k: 'HAND', seat: 0 }, 0)
		s = beamOnto(beamOnto(s, ID('c1'), ID('S')), ID('c2'), ID('S'))

		const out = moveCard(s, ID('S'), { k: 'DISCARD', seat: 0 })
		assertSerialisable(out)

		const discard = out.zones['DISCARD:0'] ?? []
		expect(discard).toContain(ID('S'))
		expect(discard).toContain(ID('c1'))
		expect(discard).toContain(ID('c2'))
		expect(discard).toHaveLength(3)
		expect(out.cards.S!.shipTokenAt).toBe('SUPPLY') // token back in the supply
		expect(out.cards.c1!.beamedTo).toBeNull()
		expect(out.cards.c2!.beamedTo).toBeNull()
		// each beamed child emitted a CARD_DISMISSED mirror
		expect(
			out.eventQueue
				.filter((e) => e.k === 'CARD_DISMISSED')
				.map((e) => e.iid)
				.sort(),
		).toEqual(['c1', 'c2'].sort())
	})

	it('beam a card to a SHIP, dismiss the beamed card → the SHIP is untouched', () => {
		let s = shipState()
		s = place(s, 'crew', ID('c1'), { k: 'HAND', seat: 0 }, 0)
		s = beamOnto(s, ID('c1'), ID('S'))

		const out = moveCard(s, ID('c1'), { k: 'DISCARD', seat: 0 })
		assertSerialisable(out)

		expect(out.zones['DISCARD:0']).toContain(ID('c1'))
		expect(out.cards.c1!.beamedTo).toBeNull()
		expect(out.cards.S!.zone).toEqual({ k: 'FLEET', seat: 0 }) // host untouched
		expect(out.cards.S!.shipTokenAt).toBe(ID('L'))
	})

	it('recall sends the Ship token to the SUPPLY, never back onto the card (todo/08 §7)', () => {
		const s = shipState()
		const out = moveCard(s, ID('S'), { k: 'HAND', seat: 0 })
		assertSerialisable(out)
		expect(out.cards.S!.zone).toEqual({ k: 'HAND', seat: 0 })
		expect(out.cards.S!.shipTokenAt).toBe('SUPPLY')
	})

	it('a LOCATION leaving play dismisses its Ships, returns Away Teams, detaches modifiers', () => {
		register([makeDef({ id: 'shp2', suit: 'SHIP', operations: [] })])
		let s = shipState()
		s = place(s, 'shp2', ID('S2'), { k: 'FLEET', seat: 1 }, 1, {
			shipTokenAt: ID('L'),
		})
		// a Location in play, controlled by seat 0, with tokens and a modifier
		let c = place(s, 'loc', ID('LC'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		c = { ...c, awayTeamsAt: { ...c.awayTeamsAt, LC: [2, 1] } }
		c = place(c, 'shp', ID('SL'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('LC'),
		})
		c = {
			...c,
			players: c.players.map((pl) =>
				pl.seat === 0
					? { ...pl, modifiers: [{ id: '1BUR02', source: ID('LC') }] }
					: pl,
			) as GameState['players'],
		}
		expect(c.players[0]!.modifiers).toHaveLength(1)

		const out = moveCard(c, ID('LC'), { k: 'LOG', seat: 0 })
		assertSerialisable(out)

		expect(out.cards.LC!.zone).toEqual({ k: 'LOG', seat: 0 })
		// ship at the location dismissed to its owner's discard
		expect(out.zones['DISCARD:0']).toContain(ID('SL'))
		expect(out.cards.SL!.shipTokenAt).toBe('SUPPLY')
		// away teams returned to their owners' captains (pools)
		expect(out.awayTeamsAt.LC).toBeUndefined()
		expect(out.players[0]!.awayTeamsInPool).toBe(2)
		expect(out.players[1]!.awayTeamsInPool).toBe(1)
		// modifier detached once its source left play
		expect(out.players[0]!.modifiers).toHaveLength(0)
		// events logged for the dismissed ship and both returned away teams
		const kinds = out.eventQueue.filter(
			(e) => e.k === 'CARD_DISMISSED' || e.k === 'AWAY_TEAM_REMOVED',
		)
		expect(kinds).toHaveLength(3)
	})
})

describe('save/load round-trip (todo/05 DoD: GameState is plain JSON)', () => {
	it('a state with zones, tokens and cascaded cards survives JSON round-trip and keeps working', () => {
		let s = shipState()
		s = place(s, 'crew', ID('c1'), { k: 'HAND', seat: 0 }, 0)
		s = beamOnto(s, ID('c1'), ID('S'))
		s = moveCard(s, ID('S'), { k: 'DISCARD', seat: 0 }) // cascades c1 down with the ship

		const roundTripped = structuredClone(
			JSON.parse(JSON.stringify(s)),
		) as GameState
		assertSerialisable(roundTripped)
		// zones reconstruct exactly
		expect(roundTripped.zones['DISCARD:0']).toEqual(s.zones['DISCARD:0'])
		expect(roundTripped.cards.S!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		expect(roundTripped.cards.c1!.beamedTo).toBeNull()
		expect(roundTripped.awayTeamsAt).toEqual(s.awayTeamsAt)
		// and the loaded state still mutates through moveCard
		const moved = moveCard(roundTripped, ID('c1'), { k: 'HAND', seat: 0 })
		expect(moved.zones['HAND:0']).toContain(ID('c1'))
		assertSerialisable(moved)
	})
})
