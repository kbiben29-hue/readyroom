// Test-support fixture for todo/06 (setup + turn loop). A programmatic card
// catalog matching rules/01 §1.3 face counts — 101 common faces + 27 Stardate
// + 24 PIC + 24 SHR = 176 — plus the crew boards. The card texts are
// simplified; the authoritative corpus lands with todo/12/13. This module must
// never import src/data/cards or cards/records: setup is catalog-driven so the
// same code runs these fixtures today and the real JSON later.
//
// Crew-deck layout (per rules/01 §1.2 / the rulebook's recommended first game):
//   PIC and SHR each have a Captain (no position indicator) + 23 cards:
//   3 DEVELOPMENT / 3 RESERVE / 17 AVAILABLE. Four of the AVAILABLE cards carry
//   the operations the turn-loop tests need:
//     *-av-01  PLAY       -> gain 1 DIL          (PLAY_CARD target)
//     *-av-02  ACTIVATION -> gain 1 GLO (action) (ACTIVATE target)
//     *-av-03  RESUPPLY   -> gain 1 LAT          (Resupply step target)
//     *-av-04  CLEANUP    -> gain 1 DIL          (Clean-up step target)

import type { CardDef } from '../data/schema'
import type { DeckId, ResourceId, StartPosition, Suit } from '../data/ids'
import type { Effect, Operation } from './resolver/nodes'
import type { MissionState } from './state'
import type {
	StardateSpec,
	BoardMissions,
	CardCatalog,
	SetupConfig,
} from './setup'

export function op(
	type: Operation['type'],
	effect: Effect,
	costsAction = false,
): Operation {
	return { type, costsAction, isAttack: false, effect, text: 'fixture op' }
}

export const gain = (res: ResourceId, amount = 1): Effect => ({
	k: 'GAIN_RESOURCE',
	res,
	amount,
})
export const drawN = (count = 1): Effect => ({ k: 'DRAW', count })
export const noop: Effect = { k: 'NOOP' }

interface FixtureCard {
	id: string
	suit: Suit
	deck?: DeckId
	startPosition?: StartPosition | null
	awayTeams?: number
	locationTier?: 'STARTING' | 'ADVANCED'
	operations?: Operation[]
}

export function mk(c: FixtureCard): CardDef {
	const def: CardDef = {
		id: c.id,
		cardId: null,
		name: c.id,
		suit: c.suit,
		deck: c.deck ?? 'COMMON',
		traits: [],
		skills: [],
		variableSkill: undefined,
		focus: null,
		vp: 0,
		vpAsterisk: false,
		startPosition: c.startPosition ?? null,
		developmentCost: null,
		operations: c.operations ?? [],
	}
	if (c.awayTeams !== undefined) def.awayTeams = c.awayTeams
	if (c.locationTier !== undefined) def.locationTier = c.locationTier
	return def
}

const n = (prefix: string, from: number, to: number): string[] => {
	const out: string[] = []
	for (let i = from; i <= to; i++)
		out.push(`${prefix}-${String(i).padStart(2, '0')}`)
	return out
}

function commonCards(): CardDef[] {
	const out: CardDef[] = []
	for (const id of n('cm-person', 1, 25)) out.push(mk({ id, suit: 'PERSON' }))
	for (const id of n('cm-cargo', 1, 16)) out.push(mk({ id, suit: 'CARGO' }))
	for (const id of n('cm-ship', 1, 13)) out.push(mk({ id, suit: 'SHIP' }))
	for (const id of n('cm-ally', 1, 13)) out.push(mk({ id, suit: 'ALLY' }))
	for (const id of n('cm-enc', 1, 8)) out.push(mk({ id, suit: 'ENCOUNTER' }))
	for (const id of n('cm-inc', 1, 6)) out.push(mk({ id, suit: 'INCIDENT' }))
	for (const id of n('cm-loc-s', 1, 8))
		out.push(mk({ id, suit: 'LOCATION', locationTier: 'STARTING' }))
	for (const id of n('cm-loc-a', 1, 12))
		out.push(mk({ id, suit: 'LOCATION', locationTier: 'ADVANCED' }))
	return out
}

/** The 27 Stardate cards: 25 two-player (sequence 1..25) + 2 Cadet Training. */
export function stardates(): StardateSpec[] {
	const out: StardateSpec[] = []
	for (let seq = 1; seq <= 25; seq++) {
		const id = `sd-${String(seq).padStart(3, '0')}`
		out.push({
			id,
			name: id,
			sequence: seq,
			glory: 2 + ((seq * 3) % 4), // printed Glory varies so tests can assert #1's value
			modes: ['TWO_PLAYER'],
			def: mk({
				id,
				suit: 'DIRECTIVE',
				operations: [op('CLEANUP', { k: 'WIPE_MARKET' })],
			}),
		})
	}
	// Cadet Training cards (rules/10 §10.1/§10.3): BOTH print 5 Glory, so the
	// fixed timeline (§10.3) is the natural consequence of the Stardate rules —
	// card 1 empties on the human's turn 5 and card 2 on turn 10. Card 1's
	// CLEAN-UP wipes the Market AND every bare neutral Location (the "turn 6
	// beginning of your Clean-up" event, resolved from heldStardate); card 2's
	// "end of the game" is the emptying/resolution itself, so its op is a NOOP.
	out.push({
		id: 'sd-cad-01',
		name: 'sd-cad-01',
		sequence: 1,
		glory: 5,
		modes: ['CADET'],
		def: mk({
			id: 'sd-cad-01',
			suit: 'DIRECTIVE',
			operations: [
				op('CLEANUP', {
					k: 'SEQ',
					steps: [{ k: 'WIPE_MARKET' }, { k: 'WIPE_NEUTRAL_ZONE' }],
				}),
			],
		}),
	})
	out.push({
		id: 'sd-cad-02',
		name: 'sd-cad-02',
		sequence: 2,
		glory: 5,
		modes: ['CADET'],
		def: mk({
			id: 'sd-cad-02',
			suit: 'DIRECTIVE',
			operations: [op('CLEANUP', { k: 'NOOP' })],
		}),
	})
	return out
}

function crewDeck(deck: DeckId, prefix: string): CardDef[] {
	const out: CardDef[] = []
	out.push(mk({ id: `${prefix}-captain`, suit: 'CAPTAIN', deck, awayTeams: 2 }))
	for (const id of n(`${prefix}-dev`, 1, 3))
		out.push(mk({ id, suit: 'DIRECTIVE', deck, startPosition: 'DEVELOPMENT' }))
	for (const id of n(`${prefix}-res`, 1, 3))
		out.push(mk({ id, suit: 'CARGO', deck, startPosition: 'RESERVE' }))
	// 17 AVAILABLE: the 4 signal cards carry the operations the turn-loop tests
	// need, then 13 inert PASSIVE cards. (*-$prefix-av-01..17)
	const avail: Array<[string, Operation[]]> = [
		[`${prefix}-av-01`, [op('PLAY', gain('DIL'))]], //              PLAY_CARD target
		[`${prefix}-av-02`, [op('ACTIVATION', gain('GLO'), true)]], //  ACTIVATE target (costs an action)
		[`${prefix}-av-03`, [op('RESUPPLY', gain('LAT'))]], //          Resupply-step target
		[`${prefix}-av-04`, [op('CLEANUP', gain('DIL'))]], //           Clean-up-step target
	]
	for (const id of n(`${prefix}-av`, 5, 17)) {
		avail.push([id, [op('PASSIVE', noop)]])
	}
	for (const [id, operations] of avail) {
		out.push(
			mk({ id, suit: 'PERSON', deck, startPosition: 'AVAILABLE', operations }),
		)
	}
	return out
}

function boards(): Partial<Record<DeckId, BoardMissions>> {
	const side = (): MissionState[] => [
		{
			index: 0,
			goal: {
				k: 'COUNT_AT_LEAST',
				query: { zones: [{ k: 'FLEET', seat: 0 }] },
				value: 0,
			},
			reward: { k: 'NOOP' },
			vp: 1,
			completed: false,
		},
		{
			index: 1,
			goal: {
				k: 'COUNT_AT_LEAST',
				query: { zones: [{ k: 'FLEET', seat: 0 }] },
				value: 0,
			},
			reward: { k: 'NOOP' },
			vp: 2,
			completed: false,
		},
		{
			index: 2,
			goal: {
				k: 'COUNT_AT_LEAST',
				query: { zones: [{ k: 'FLEET', seat: 0 }] },
				value: 0,
			},
			reward: { k: 'NOOP' },
			vp: 3,
			completed: false,
		},
	]
	return {
		PIC: { basic: side(), advanced: side() },
		SHR: { basic: side(), advanced: side() },
	}
}

/** The full catalog: 101 common + 27 Stardate + 24 PIC + 24 SHR = 176 ids. */
export function picShrCatalog(): CardCatalog {
	return {
		defs: [
			...commonCards(),
			...crewDeck('PIC', 'pic'),
			...crewDeck('SHR', 'shr'),
		],
		stardates: stardates(),
		boards: boards(),
	}
}

export const picShrConfig: SetupConfig = {
	mode: 'TWO_PLAYER',
	players: [
		{ deck: 'PIC', boardSide: 'BASIC' },
		{ deck: 'SHR', boardSide: 'BASIC' },
	],
	seed: 1,
}

/** Human-readable card-def lookup for assertions (def id -> def). */
export function defIndex(catalog: CardCatalog): Map<string, CardDef> {
	const m = new Map<string, CardDef>()
	for (const d of catalog.defs) m.set(d.id, d)
	for (const s of catalog.stardates) m.set(s.id, s.def)
	return m
}
