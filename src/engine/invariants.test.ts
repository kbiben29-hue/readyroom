import { describe, expect, it, beforeAll } from 'vitest'

import { loadCatalog } from '../data/catalog'
import type { CardCatalog } from './setup'
import { setup, type SetupConfig } from './setup'
import type { GameState } from './state'
import type { CardInstanceId } from './ids'
import { assertInvariants, assertSerialisable } from './invariants'

let catalog: CardCatalog
let config: SetupConfig
let state: GameState

beforeAll(async () => {
	catalog = await loadCatalog()
	config = {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: 'PIC', boardSide: 'ADVANCED' },
			{ deck: 'SHR', boardSide: 'ADVANCED' },
		],
		seed: 5,
	}
	state = setup(config, catalog)
})

/** A deep copy of a healthy setup state, then `mutate` breaks one invariant. */
function broken(mutate: (s: GameState) => void): GameState {
	const s = JSON.parse(JSON.stringify(state)) as GameState
	mutate(s)
	return s
}

describe('assertSerialisable', () => {
	it('accepts plain serialisable data', () => {
		expect(() =>
			assertSerialisable({ a: 1, b: 'x', c: [1, 2], d: { e: null, f: true } }),
		).not.toThrow()
	})

	it('rejects functions', () => {
		expect(() => assertSerialisable({ fn: () => 1 })).toThrow(/function/)
	})

	it('rejects bigint and symbol', () => {
		expect(() => assertSerialisable({ big: 1n })).toThrow(/bigint/)
		expect(() => assertSerialisable({ sym: Symbol('x') })).toThrow(/symbol/)
	})

	it('rejects Map, Set and Date', () => {
		expect(() => assertSerialisable({ a: new Map() })).toThrow(/Map\/Set/)
		expect(() => assertSerialisable({ d: new Date() })).toThrow(/Date/)
	})

	it('rejects cycles', () => {
		const o: Record<string, unknown> = {}
		o.self = o
		expect(() => assertSerialisable(o)).toThrow(/cycle/)
	})
})

describe('assertInvariants (todo/16 §4)', () => {
	it('the healthy setup state passes every invariant', () => {
		expect(() => assertInvariants(state)).not.toThrow()
	})

	it('card conservation: a card left out of every zone', () => {
		const s = broken((st) => {
			const key = Object.keys(st.zones)[0]!
			st.zones[key] = st.zones[key]!.slice(1) // drop the first listed card
		})
		expect(() => assertInvariants(s)).toThrow(/in no zone|zone entries/)
	})

	it('away-team conservation: pool + locations != total', () => {
		const s = broken((st) => {
			st.players[1]!.awayTeamsInPool += 1
		})
		expect(() => assertInvariants(s)).toThrow(
			/away-team conservation for seat 1/,
		)
	})

	it('away-team monotonicity: total never decreases across an intent', () => {
		const since = broken((st) => {
			st.players[0]!.awayTeamsTotal += 1
		})
		expect(() => assertInvariants(state, { since })).toThrow(/fell from/)
	})

	it('ship-token uniqueness: a deployed ship with its token in the supply', () => {
		const shipped = Object.entries(state.cards).find(
			([, c]) => c.zone.k === 'FLEET',
		)?.[0]
		expect(shipped).toBeDefined()
		const s = broken((st) => {
			st.cards[shipped!]!.shipTokenAt = 'SUPPLY'
		})
		expect(() => assertInvariants(s)).toThrow(/has its token in the supply/)
	})

	it('actions: a negative budget is rejected', () => {
		const s = broken((st) => {
			st.players[0]!.actions.available = -1
		})
		expect(() => assertInvariants(s)).toThrow(/actions invariant/)
	})

	it('specialty tracks stay in 0..15', () => {
		const s = broken((st) => {
			st.players[0]!.specialties.RESEARCH = 99
		})
		expect(() => assertInvariants(s)).toThrow(/specialty invariant/)
	})

	it('resources are never negative', () => {
		const s = broken((st) => {
			st.players[1]!.resources.DIL = -1
		})
		expect(() => assertInvariants(s)).toThrow(/resource invariant/)
	})

	it('a non-beamed card never carries a beamedTo pointer', () => {
		const plain = Object.entries(state.cards).find(
			([, c]) => c.zone.k !== 'BEAMED',
		)?.[0]
		expect(plain).toBeDefined()
		const s = broken((st) => {
			st.cards[plain!]!.beamedTo = 'cm#0000' as CardInstanceId
		})
		expect(() => assertInvariants(s)).toThrow(/beamed invariant/)
	})

	it('the stack is never non-empty while idle (no choice, no result)', () => {
		const iid = Object.values(state.cards)[0]!.iid
		const s = broken((st) => {
			st.result = null
			st.pendingChoice = null
			st.stack = [{ k: 'EMIT', event: { k: 'CARD_PLAYED', iid, seat: 0 } }]
		})
		expect(() => assertInvariants(s)).toThrow(/stack invariant/)
	})
})
