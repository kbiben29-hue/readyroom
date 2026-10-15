// docs/data-model.md §3 zone-properties table — one row per test. These encode
// rules/08 → in play and rules/12 §12.3 (§12.5 Staging skills count, beamed
// skills do not), plus ordering/visibility per zone. zoneKey must be a stable,
// injective serialisation of a ZoneRef.

import { describe, expect, it } from 'vitest'
import { zoneKey, zoneProps } from './state'
import type { ZoneRef } from './resolver/queries'

const Z = {
	marketDeck: { k: 'MARKET_DECK', suit: 'SHIP' } as ZoneRef,
	marketOffer: { k: 'MARKET_OFFER', suit: 'CARGO' } as ZoneRef,
	encounter: { k: 'ENCOUNTER_DECK' } as ZoneRef,
	incident: { k: 'INCIDENT_DECK' } as ZoneRef,
	locationDeck: { k: 'LOCATION_DECK' } as ZoneRef,
	neutral: { k: 'NEUTRAL_ZONE', slot: 1 } as ZoneRef,
	junk: { k: 'JUNK' } as ZoneRef,
	stardate: { k: 'STARDATE_PILE' } as ZoneRef,
	box: { k: 'BOX' } as ZoneRef,
	hand0: { k: 'HAND', seat: 0 } as ZoneRef,
	draw0: { k: 'DRAW', seat: 0 } as ZoneRef,
	discard0: { k: 'DISCARD', seat: 0 } as ZoneRef,
	reserve0: { k: 'RESERVE', seat: 0 } as ZoneRef,
	development0: { k: 'DEVELOPMENT', seat: 0 } as ZoneRef,
	log0: { k: 'LOG', seat: 0 } as ZoneRef,
	staging0: { k: 'STAGING', seat: 0 } as ZoneRef,
	fleet0: { k: 'FLEET', seat: 0 } as ZoneRef,
	locArea0: { k: 'LOCATION_AREA', seat: 0 } as ZoneRef,
	duty0: { k: 'DUTY_OFFICER', seat: 0 } as ZoneRef,
	captain0: { k: 'CAPTAIN', seat: 0 } as ZoneRef,
	status0: { k: 'STATUS', seat: 0 } as ZoneRef,
	beamed: { k: 'BEAMED', host: 'p0#0042' } as ZoneRef,
}

describe('zoneProps: docs/data-model.md §3 table rows', () => {
	it('LOCATION_AREA: in play, counts, table ops, unordered, public', () => {
		expect(zoneProps(Z.locArea0)).toEqual({
			inPlay: true,
			traitsCount: true,
			skillsCount: true,
			tableOps: true,
			ordered: false,
			visibleTo: 'ALL',
		})
	})
	it('FLEET: in play, counts, table ops, unordered, public', () => {
		expect(zoneProps(Z.fleet0)).toEqual({
			inPlay: true,
			traitsCount: true,
			skillsCount: true,
			tableOps: true,
			ordered: false,
			visibleTo: 'ALL',
		})
	})
	it('DUTY_OFFICER: in play, counts, table ops, unordered, public', () => {
		expect(zoneProps(Z.duty0)).toEqual({
			inPlay: true,
			traitsCount: true,
			skillsCount: true,
			tableOps: true,
			ordered: false,
			visibleTo: 'ALL',
		})
	})
	it('CAPTAIN: in play, counts, table ops, unordered, public', () => {
		expect(zoneProps(Z.captain0)).toEqual({
			inPlay: true,
			traitsCount: true,
			skillsCount: true,
			tableOps: true,
			ordered: false,
			visibleTo: 'ALL',
		})
	})
	it('STATUS: in play, counts, table ops, unordered, public', () => {
		expect(zoneProps(Z.status0)).toEqual({
			inPlay: true,
			traitsCount: true,
			skillsCount: true,
			tableOps: true,
			ordered: false,
			visibleTo: 'ALL',
		})
	})
	it('STAGING: in play, counts, NO table ops, unordered, public (rules/12 §12.3)', () => {
		expect(zoneProps(Z.staging0)).toEqual({
			inPlay: true,
			traitsCount: true,
			skillsCount: true,
			tableOps: false,
			ordered: false,
			visibleTo: 'ALL',
		})
	})
	it('BEAMED: in play, counts traits, NO skills, NO table ops, public (rules/12 §12.5)', () => {
		expect(zoneProps(Z.beamed)).toEqual({
			inPlay: true,
			traitsCount: true,
			skillsCount: false,
			tableOps: false,
			ordered: false,
			visibleTo: 'ALL',
		})
	})
	it('HAND: not in play, owner-only', () => {
		expect(zoneProps(Z.hand0)).toEqual({
			inPlay: false,
			traitsCount: false,
			skillsCount: false,
			tableOps: false,
			ordered: false,
			visibleTo: 'OWNER',
		})
	})
	it('DRAW: not in play, ordered, hidden', () => {
		expect(zoneProps(Z.draw0)).toEqual({
			inPlay: false,
			traitsCount: false,
			skillsCount: false,
			tableOps: false,
			ordered: true,
			visibleTo: 'NONE',
		})
	})
	it('DISCARD: not in play, UNordered, public (order is irrelevant, rules note)', () => {
		expect(zoneProps(Z.discard0)).toEqual({
			inPlay: false,
			traitsCount: false,
			skillsCount: false,
			tableOps: false,
			ordered: false,
			visibleTo: 'ALL',
		})
	})
	it('RESERVE: not in play, ordered, hidden', () => {
		expect(zoneProps(Z.reserve0)).toEqual({
			inPlay: false,
			traitsCount: false,
			skillsCount: false,
			tableOps: false,
			ordered: true,
			visibleTo: 'NONE',
		})
	})
	it('DEVELOPMENT: not in play, public', () => {
		expect(zoneProps(Z.development0)).toEqual({
			inPlay: false,
			traitsCount: false,
			skillsCount: false,
			tableOps: false,
			ordered: false,
			visibleTo: 'ALL',
		})
	})
	it('LOG: not in play, owner-only', () => {
		expect(zoneProps(Z.log0)).toEqual({
			inPlay: false,
			traitsCount: false,
			skillsCount: false,
			tableOps: false,
			ordered: false,
			visibleTo: 'OWNER',
		})
	})
	it('MARKET_OFFER: not in play, public', () => {
		expect(zoneProps(Z.marketOffer)).toEqual({
			inPlay: false,
			traitsCount: false,
			skillsCount: false,
			tableOps: false,
			ordered: false,
			visibleTo: 'ALL',
		})
	})
	it('MARKET_DECK / ENCOUNTER_DECK / INCIDENT_DECK / LOCATION_DECK: ordered facedown decks, hidden', () => {
		const expected = {
			inPlay: false,
			traitsCount: false,
			skillsCount: false,
			tableOps: false,
			ordered: true,
			visibleTo: 'NONE',
		}
		expect(zoneProps(Z.marketDeck)).toEqual(expected)
		expect(zoneProps(Z.encounter)).toEqual(expected)
		expect(zoneProps(Z.incident)).toEqual(expected)
		expect(zoneProps(Z.locationDeck)).toEqual(expected)
	})
	it('NEUTRAL_ZONE: not in play, public', () => {
		expect(zoneProps(Z.neutral)).toEqual({
			inPlay: false,
			traitsCount: false,
			skillsCount: false,
			tableOps: false,
			ordered: false,
			visibleTo: 'ALL',
		})
	})
	it('JUNK / BOX: not in play, public (removed-from-game bins)', () => {
		const expected = {
			inPlay: false,
			traitsCount: false,
			skillsCount: false,
			tableOps: false,
			ordered: false,
			visibleTo: 'ALL',
		}
		expect(zoneProps(Z.junk)).toEqual(expected)
		expect(zoneProps(Z.box)).toEqual(expected)
	})
	it('STARDATE_PILE: not in play, ordered, public', () => {
		expect(zoneProps(Z.stardate)).toEqual({
			inPlay: false,
			traitsCount: false,
			skillsCount: false,
			tableOps: false,
			ordered: true,
			visibleTo: 'ALL',
		})
	})
})

describe('zoneKey: injective, stable serialisation', () => {
	it('every representative ZoneRef keys to a unique string (docs examples)', () => {
		const refs: ZoneRef[] = [
			Z.marketDeck,
			{ k: 'MARKET_DECK', suit: 'PERSON' },
			{ k: 'MARKET_DECK', suit: 'ALLY' },
			Z.marketOffer,
			{ k: 'MARKET_OFFER', suit: 'PERSON' },
			Z.encounter,
			Z.incident,
			Z.locationDeck,
			{ k: 'NEUTRAL_ZONE', slot: 0 },
			{ k: 'NEUTRAL_ZONE', slot: 1 },
			{ k: 'NEUTRAL_ZONE', slot: 2 },
			Z.junk,
			Z.stardate,
			Z.box,
			{ k: 'HAND', seat: 0 },
			{ k: 'HAND', seat: 1 },
			{ k: 'DRAW', seat: 0 },
			{ k: 'DRAW', seat: 1 },
			{ k: 'DISCARD', seat: 0 },
			{ k: 'RESERVE', seat: 1 },
			{ k: 'DEVELOPMENT', seat: 0 },
			{ k: 'LOG', seat: 1 },
			{ k: 'STAGING', seat: 0 },
			{ k: 'FLEET', seat: 1 },
			{ k: 'LOCATION_AREA', seat: 0 },
			{ k: 'DUTY_OFFICER', seat: 1 },
			{ k: 'CAPTAIN', seat: 0 },
			{ k: 'STATUS', seat: 1 },
			{ k: 'BEAMED', host: 'p0#0042' },
			{ k: 'BEAMED', host: 'p0#0043' },
		]
		const keys = refs.map((r) => zoneKey(r))
		expect(new Set(keys).size).toBe(keys.length)
	})
	it('BEAMED and per-player seats are distinct keys (no collision with zone names)', () => {
		expect(zoneKey({ k: 'BEAMED', host: 'p0#0042' })).toBe('BEAMED:p0#0042')
		expect(zoneKey({ k: 'HAND', seat: 0 })).toBe('HAND:0')
		expect(zoneKey({ k: 'MARKET_OFFER', suit: 'CARGO' })).toBe(
			'MARKET_OFFER:CARGO',
		)
		expect(zoneKey({ k: 'NEUTRAL_ZONE', slot: 2 })).toBe('NEUTRAL_ZONE:2')
	})
})
