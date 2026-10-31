// The 2KHA crew deck from To Boldly Go (src/data/cards/crew/kha.json).
// Pins its setup (no Reserve deck, two double-sided cards set up front side
// up), the trait-marking board (MARK_TRAIT and its two opponent-CAPTAIN
// entries), FLIP, GIVE, the rule changes (no Specialty gains, the flipped CAPTAIN
// ignoring requirements) and the flipped CAPTAIN's endgame.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from '../data/catalog'
import { CardArraySchema, type CardDef } from '../data/schema'
import { fresh, register, makeDef, place, ID } from './resolver/testUtils'
import { run } from './resolver/stack'
import { applyChoice, type PendingChoice } from './resolver/choices'
import { score } from './scoring'
import { setup, type CardCatalog } from './setup'
import { meetsRequirement } from './modifiers'
import { zoneKey, type GameState } from './state'
import type { Effect } from './resolver/nodes'
import type { TraitId } from '../data/ids'

const byCardId = new Map<string, CardDef>()
for (const deck of ['kha', 'kir']) {
	const raw: unknown = JSON.parse(
		readFileSync(join(__dirname, `../data/cards/crew/${deck}.json`), 'utf8'),
	)
	for (const def of CardArraySchema.parse(raw))
		if (def.cardId !== null) byCardId.set(def.cardId, def)
}
register([...byCardId.values()])
const def = (cardId: string): string => byCardId.get(cardId)!.id
const CAP_FRONT = def('2KHA01A/22')
const CAP_BACK = def('2KHA01B/22')
const OPP_CAPTAIN = def('2KIRK01/25') // HUMAN, STARFLEET

const BOARD: TraitId[] = ['SPY', 'DOCTOR', 'CLOAK']
register([
	makeDef({ id: 'kxSpyDoc', suit: 'PERSON', traits: ['SPY', 'DOCTOR'], operations: [] }),
	makeDef({ id: 'kxFleet', suit: 'PERSON', traits: ['HUMAN', 'STARFLEET'], operations: [] }),
	makeDef({ id: 'kxIncident', suit: 'INCIDENT', vp: -2, operations: [] }),
	{
		...makeDef({ id: 'kxFocus', suit: 'PERSON', operations: [] }),
		focus: 'FOCUS_MILITARY',
	},
])

/** Resolve one effect for seat 0 from `source`, answering trait picks with
 *  `trait` and everything else with the first option. */
function resolve(
	state: GameState,
	effect: Effect,
	source: string,
	trait?: TraitId,
): GameState {
	let s = run({
		...state,
		stack: [
			...state.stack,
			{ k: 'EFFECT', node: effect, ctx: { actor: 0, source: ID(source), bindings: {} }, ip: 0 },
		],
	})
	const pick = (c: PendingChoice): unknown => {
		switch (c.k) {
			case 'CHOOSE_TRAIT':
				return trait ?? c.traits[0]
			case 'CHOOSE_CARDS':
				return c.candidates.slice(0, Math.max(c.min, 1))
			case 'CONFIRM':
				return true
			case 'CHOOSE_OPTION':
				return { key: c.options.find((o) => o.enabled)!.key }
			default:
				throw new Error(`unhandled ${c.k}`)
		}
	}
	for (let guard = 0; s.pendingChoice !== null; guard++) {
		if (guard > 20) throw new Error('too many choices')
		const c = s.pendingChoice
		s = run(applyChoice(s, { t: 'RESOLVE_CHOICE', choiceId: c.id, selection: pick(c) as never }))
	}
	return s
}

// "mark a trait of a card in your hand" — the tests keep one card there
const MARK: Effect = {
	k: 'MARK_TRAIT',
	traits: BOARD,
	opponentCaptain: 2,
	from: { zones: [{ k: 'HAND', seat: 0 }], seat: 'SELF' },
}

function table(): GameState {
	let s = place(fresh(), CAP_FRONT, ID('kc'), { k: 'CAPTAIN', seat: 0 }, 0)
	s = place(s, OPP_CAPTAIN, ID('oc'), { k: 'CAPTAIN', seat: 1 }, 1)
	return s
}

function markWith(s: GameState, trait?: TraitId): GameState {
	return resolve(s, MARK, 'kc', trait)
}

let catalog: CardCatalog
beforeAll(async () => {
	catalog = await loadCatalog()
})

describe('KHA setup', () => {
	it('sets up front sides only and has no Reserve deck', () => {
		const s = setup(
			{
				mode: 'TWO_PLAYER',
				players: [
					{ deck: 'KHA', boardSide: 'ADVANCED' },
					{ deck: 'KIR', boardSide: 'BASIC' },
				],
				seed: 5,
				box: 'TBG',
			},
			catalog,
		)
		const zone = (k: string) => s.zones[zoneKey({ k, seat: 0 } as never)] ?? []
		expect(zone('CAPTAIN').map((i) => s.cards[i]!.def)).toEqual([CAP_FRONT])
		expect(zone('RESERVE')).toHaveLength(0)
		expect(zone('DEVELOPMENT')).toHaveLength(8)
		expect(zone('LOCATION_AREA').map((i) => s.cards[i]!.def).sort()).toEqual(
			[def('2KHA02A/22'), def('2KHA03/22')].sort(),
		)
		expect(zone('HAND').length + zone('DRAW').length).toBe(10)
		expect(Object.values(s.cards).some((c) => c.def === CAP_BACK)).toBe(false)
		expect(s.players[0].missions.map((m) => m.cardId)).toEqual([
			'2KHA/M1',
			'2KHA/M2',
			'2KHA/M3',
		])
	})
})

describe('MARK_TRAIT', () => {
	it('marks the chosen board trait once', () => {
		let s = place(table(), 'kxSpyDoc', ID('c1'), { k: 'HAND', seat: 0 }, 0)
		s = markWith(s, 'DOCTOR')
		expect(s.players[0].markedTraits).toEqual(['DOCTOR'])
		s = markWith(s)
		// DOCTOR is taken; SPY is the only board trait left on the card
		expect(s.players[0].markedTraits).toEqual(['DOCTOR', 'SPY'])
	})

	it("fills the opponent-captain entries with two different traits", () => {
		let s = place(table(), 'kxFleet', ID('f1'), { k: 'HAND', seat: 0 }, 0)
		s = markWith(s, 'STARFLEET')
		s = markWith(s)
		// the captain has only one non-HUMAN trait, so HUMAN counts too
		expect(s.players[0].markedTraits).toEqual(['OPP:STARFLEET', 'OPP:HUMAN'])
		const before = s
		s = markWith(s)
		expect(s.players[0].markedTraits).toEqual(before.players[0].markedTraits)
	})
})

describe('rule changes', () => {
	it('Specialty gains have no effect for this crew', () => {
		const s = resolve(table(), { k: 'ADVANCE_SPECIALTY', specialty: 'MILITARY', amount: 3 }, 'kc')
		expect(s.players[0].specialties.MILITARY).toBe(0)
	})

	it('only the flipped side ignores Specialty requirements', () => {
		const req = { specialty: 'MILITARY' as const, min: 5 }
		expect(meetsRequirement(table(), 0, req)).toBe(false)
		const s = resolve(table(), { k: 'FLIP', target: { zones: [{ k: 'CAPTAIN', seat: 0 }] }, to: CAP_BACK }, 'kc')
		expect(s.cards[ID('kc')]!.def).toBe(CAP_BACK)
		expect(meetsRequirement(s, 0, req)).toBe(true)
	})

	it('GIVE puts a card in the opponent’s Discard pile as theirs', () => {
		let s = place(table(), 'kxIncident', ID('i1'), { k: 'HAND', seat: 0 }, 0)
		s = resolve(s, { k: 'GIVE', target: { zones: [{ k: 'HAND', seat: 0 }], seat: 'SELF' }, to: 'DISCARD' }, 'kc')
		expect(s.cards[ID('i1')]!.owner).toBe(1)
		expect(s.zones[zoneKey({ k: 'DISCARD', seat: 1 })]).toContain(ID('i1'))
	})
})

describe('flipped CAPTAIN endgame', () => {
	function flipped(marked: number): GameState {
		let s = place(fresh(), CAP_BACK, ID('wk'), { k: 'CAPTAIN', seat: 0 }, 0)
		s = place(s, 'kxFocus', ID('fa'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'kxFocus', ID('fb'), { k: 'STAGING', seat: 0 }, 0)
		const markedTraits = Array.from({ length: marked }, (_, i) => `T${i}`)
		return {
			...s,
			players: [{ ...s.players[0], markedTraits }, s.players[1]],
		}
	}
	const vp = (s: GameState) => score(s, 0).endgame.find((e) => e.card === ID('wk'))?.vp

	it('scores 1 VP per Focus icon', () => {
		expect(vp(flipped(11))).toBe(2)
	})

	it('scores 3 VP per Focus icon with all 12 traits marked', () => {
		expect(vp(flipped(12))).toBe(6)
	})
})
