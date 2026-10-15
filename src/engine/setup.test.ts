// todo/06 §1 — central + player setup against rules/02, driven by an injected
// fixture catalog (PIC vs SHR, the rulebook's recommended first game).
// Every assertion here is against rules/02 §2.1/§2.2 and the fixture's own
// face grants (rules/01 §1.3 counts: 101 common + 27 Stardate + 24 + 24 crew).

import { describe, expect, it } from 'vitest'
import { setup, setupGame, assertSetupCompleteness } from './setup'
import type { SetupConfig } from './setup'
import { zoneKey, player } from './state'
import { newGameState } from './state'
import { registerCards } from './cards'
import { assertSerialisable } from './invariants'
import { picShrCatalog, picShrConfig, defIndex } from './todo06Fixture'
import type { CardInstanceId } from './ids'

const catalog = picShrCatalog()
const idx = defIndex(catalog)
const sd001 = catalog.stardates.find((st) => st.id === 'sd-001')!

function setupSeed(seed: number) {
	return setup({ ...picShrConfig, seed }, catalog)
}

describe('setup: central board (rules/02 §2.1)', () => {
	const s = setupSeed(1)

	it('places every face: 176 = 101 common + 27 Stardate + 48 crew', () => {
		expect(Object.keys(s.cards)).toHaveLength(176)
		expect(s.phase).toEqual({ k: 'SETUP' })
	})

	it('Market offer has 4 cards, one per suit, each from the right common deck', () => {
		for (const suit of ['PERSON', 'CARGO', 'SHIP', 'ALLY'] as const) {
			const offer = s.zones[zoneKey({ k: 'MARKET_OFFER', suit })] ?? []
			expect(offer).toHaveLength(1)
			const def = idx.get(s.cards[offer[0]!]!.def)!
			expect(def.suit).toBe(suit)
			expect(def.deck).toBe('COMMON')
		}
	})

	it('Neutral Zone holds 3 Starting Locations; Location deck = 1 unseen Starting on top of the Advanced pile', () => {
		for (const slot of [0, 1, 2] as const) {
			const arr = s.zones[zoneKey({ k: 'NEUTRAL_ZONE', slot })] ?? []
			expect(arr).toHaveLength(1)
			expect(idx.get(s.cards[arr[0]!]!.def)!.locationTier).toBe('STARTING')
		}
		const locDeck = s.zones['LOCATION_DECK'] ?? []
		expect(locDeck).toHaveLength(13) // 1 Starting + 12 Advanced
		expect(idx.get(s.cards[locDeck[0]!]!.def)!.locationTier).toBe('STARTING')
		for (const iid of locDeck.slice(1)) {
			expect(idx.get(s.cards[iid]!.def)!.locationTier).toBe('ADVANCED')
		}
	})

	it('unused Starting Locations and out-of-mode Stardate cards return to the box', () => {
		const box = s.zones['BOX'] ?? []
		expect(box).toHaveLength(6) // 4 spare Starting + 2 Cadet Stardates
		const boxDefs = box.map((i) => s.cards[i]!.def).sort()
		expect(boxDefs.filter((d) => d.startsWith('cm-loc-s-'))).toHaveLength(4)
		expect(boxDefs.filter((d) => d.startsWith('sd-cad-'))).toHaveLength(2)
	})

	it('Stardate track: #1 on top with its printed Glory; 25 two-player cards, 2 Cadet boxed', () => {
		expect(s.stardates.pile).toHaveLength(25)
		// index 0 = topmost/current (rules/02 §2.1 #11 "with #1 on top")
		const top = s.stardates.pile[0]!
		expect(s.cards[top]!.def).toBe('sd-001')
		expect(s.stardates.gloryOnTop).toBe(sd001.glory) // step #13: seeded from the supply
		// sequence order: index 0 is #1, so the sequence ascends down the pile
		const seqs = s.stardates.pile.map((i) => {
			const id = s.cards[i]!.def
			return catalog.stardates.find((st) => st.id === id)!
		})
		for (let i = 1; i < seqs.length; i++) {
			expect(seqs[i]!.sequence).toBeGreaterThan(seqs[i - 1]!.sequence)
		}
	})

	it('Encounter deck holds 8; Junk starts empty', () => {
		expect(s.zones['ENCOUNTER_DECK'] ?? []).toHaveLength(8)
		expect(s.zones['JUNK'] ?? []).toHaveLength(0)
	})

	it('deterministically seeds the shuffled common decks (seed=1 snapshot)', () => {
		const defs = (iids: readonly CardInstanceId[]) =>
			iids.map((i) => s.cards[i]!.def)
		expect(defs(s.zones['INCIDENT_DECK'] ?? [])).toEqual([
			'cm-inc-02',
			'cm-inc-05',
			'cm-inc-04',
			'cm-inc-01',
			'cm-inc-06',
			'cm-inc-03',
		])
		expect(s.zones['LOCATION_DECK']?.[0]).not.toBeUndefined()
		const locDeck = defs(s.zones['LOCATION_DECK'] ?? [])
		expect(locDeck[0]).toBe('cm-loc-s-07')
		expect(locDeck.slice(1)).toEqual([
			'cm-loc-a-01',
			'cm-loc-a-08',
			'cm-loc-a-11',
			'cm-loc-a-03',
			'cm-loc-a-07',
			'cm-loc-a-06',
			'cm-loc-a-12',
			'cm-loc-a-05',
			'cm-loc-a-02',
			'cm-loc-a-04',
			'cm-loc-a-10',
			'cm-loc-a-09',
		])
		// Market decks: 24 PERSON / 15 CARGO / 12 SHIP / 12 ALLY remaining after the reveal
		expect(defs(s.zones['MARKET_DECK:PERSON'] ?? [])).toHaveLength(24)
		expect(defs(s.zones['MARKET_DECK:CARGO'] ?? [])).toHaveLength(15)
		expect(defs(s.zones['MARKET_DECK:SHIP'] ?? [])).toHaveLength(12)
		expect(defs(s.zones['MARKET_DECK:ALLY'] ?? [])).toHaveLength(12)
		// top-person card (next to reveal) is fixed by the seed
		expect(defs(s.zones['MARKET_DECK:PERSON'] ?? [])[0]).toBe('cm-person-18')
	})
})

describe('setup: players (rules/02 §2.2)', () => {
	const s = setupSeed(1)

	it('gives each player an opening hand of 5 and a pool of {DIL:1, LAT:1, GLO:1}', () => {
		for (const seat of [0, 1] as const) {
			expect(s.zones[zoneKey({ k: 'HAND', seat })] ?? []).toHaveLength(5)
			expect(player(s, seat).resources).toEqual({ DIL: 1, LAT: 1, GLO: 1 })
			expect(player(s, seat).actions).toEqual({ available: 3, spent: 0 })
			expect(player(s, seat).handSize).toBe(5)
			expect(player(s, seat).missionTokens).toBe(1) // Basic side keeps 1 (rules/02 §2.2 #1)
			expect(player(s, seat).dutyOfficerLimit).toBe(1)
		}
	})

	it('away teams come from the Captain card and sit on it', () => {
		for (const seat of [0, 1] as const) {
			expect(player(s, seat).awayTeamsInPool).toBe(2) // fixture Captain prints 2
			expect(player(s, seat).awayTeamsTotal).toBe(2)
		}
	})

	it('splits each crew deck by position indicator: 3 DEV / 3 RESERVE / 17 AVAILABLE + Captain', () => {
		for (const [seat, , prefix] of [
			[0, 'PIC', 'pic'],
			[1, 'SHR', 'shr'],
		] as const) {
			const owned = Object.values(s.cards).filter((c) => c.owner === seat)
			expect(owned).toHaveLength(24)
			const defOf = (i: CardInstanceId) => s.cards[i]!.def
			const dev = (s.zones[zoneKey({ k: 'DEVELOPMENT', seat })] ?? [])
				.map(defOf)
				.sort()
			const res = (s.zones[zoneKey({ k: 'RESERVE', seat })] ?? [])
				.map(defOf)
				.sort()
			const hand = (s.zones[zoneKey({ k: 'HAND', seat })] ?? [])
				.map(defOf)
				.sort()
			const draw = (s.zones[zoneKey({ k: 'DRAW', seat })] ?? [])
				.map(defOf)
				.sort()
			const allAvail = [...hand, ...draw]
			expect(dev).toEqual([
				`${prefix}-dev-01`,
				`${prefix}-dev-02`,
				`${prefix}-dev-03`,
			])
			expect(res).toEqual([
				`${prefix}-res-01`,
				`${prefix}-res-02`,
				`${prefix}-res-03`,
			])
			expect(allAvail).toHaveLength(17)
			const captains = (s.zones[zoneKey({ k: 'CAPTAIN', seat })] ?? []).map(
				defOf,
			)
			expect(captains).toEqual([`${prefix}-captain`])
			// no DEPLOYED / CONTROLLED_LOCATION / DISCARD / STATUS for PIC & SHR
			for (const z of ['FLEET', 'LOCATION_AREA', 'DISCARD', 'STATUS']) {
				expect(s.zones[zoneKey({ k: z as 'FLEET', seat })] ?? []).toHaveLength(
					0,
				)
			}
		}
	})

	it('seeds the player decks deterministically (seed=1 snapshot)', () => {
		const defs = (iids: readonly CardInstanceId[]) =>
			iids.map((i) => s.cards[i]!.def)
		expect(defs(s.zones['DRAW:0'] ?? [])).toEqual([
			'pic-av-17',
			'pic-av-09',
			'pic-av-12',
			'pic-av-02',
			'pic-av-04',
			'pic-av-05',
			'pic-av-14',
			'pic-av-11',
			'pic-av-15',
			'pic-av-13',
			'pic-av-06',
			'pic-av-07',
		])
		expect(defs(s.zones['RESERVE:0'] ?? [])).toEqual([
			'pic-res-01',
			'pic-res-02',
			'pic-res-03',
		])
		// SHR's deck uses a different shuffe draw (seat 1 boards are set up second)
		expect(defs(s.zones['DRAW:1'] ?? [])).not.toEqual(
			defs(s.zones['DRAW:0'] ?? []),
		)
	})

	it('every one of the 176 cards sits in exactly one zone', () => {
		const seen = new Set<string>()
		for (const arr of Object.values(s.zones)) {
			for (const iid of arr) {
				expect(seen.has(iid)).toBe(false) // no card in two zones
				seen.add(iid)
			}
		}
		for (const iid of Object.keys(s.cards)) {
			expect(seen.has(iid)).toBe(true) // no orphan card (" + iid + ")
		}
	})
})

describe('setup: determinism + invariants', () => {
	it('same seed twice → deep-equal states (byte-identical JSON)', () => {
		const a = setupSeed(1)
		const b = setupSeed(1)
		expect(a).toEqual(b)
		expect(JSON.stringify(a)).toBe(JSON.stringify(b))
	})

	it('different seeds differ (shuffle/starting player)', () => {
		const a = setupSeed(1)
		const b = setupSeed(2)
		expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
	})

	it('setup output is serialisable', () => {
		assertSerialisable(setupSeed(1))
	})

	it('assertSetupCompleteness throws on a missing card', () => {
		let s = setupSeed(1)
		const victim = Object.keys(s.cards)[0]!
		const { [victim]: _gone, ...rest } = s.cards
		s = { ...s, cards: rest }
		expect(() =>
			assertSetupCompleteness(s, { ...picShrConfig, seed: 1 }, catalog),
		).toThrow(/expected exactly 1 instance/)
	})

	it('assertSetupCompleteness throws when a card sits in two zones', () => {
		let s = setupSeed(1)
		const hand0 = s.zones['HAND:0'] ?? []
		const moving = hand0[0]!
		// re-append the same iid to another zone key without moveCard (simulate corruption)
		s = {
			...s,
			zones: {
				...s.zones,
				['STAGING:0']: [...(s.zones['STAGING:0'] ?? []), moving],
			},
		}
		expect(() =>
			assertSetupCompleteness(s, { ...picShrConfig, seed: 1 }, catalog),
		).toThrow(/sits in two zones/)
	})

	it('setupGame works from a bare state once the catalog is registered', () => {
		registerCards([...catalog.defs, ...catalog.stardates.map((st) => st.def)])
		const cfg: SetupConfig = { ...picShrConfig, seed: 3 }
		const out = setupGame(newGameState(3, { mode: 'TWO_PLAYER' }), cfg, catalog)
		expect(Object.keys(out.cards)).toHaveLength(176)
		assertSerialisable(out)
	})
})
