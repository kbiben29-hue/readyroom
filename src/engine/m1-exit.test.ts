// M1 EXIT TEST — the engine-track acceptance gate (todo/00 roadmap: "a scripted
// game using ~8 hand-written fake cards plays from setup to final score,
// headless, deterministically").
//
// Two scripted fixture games through the REAL engine (setup -> turn loop ->
// market/control activity -> an end condition -> final scoring):
//   Game 1 (Resolution): a 4-turn, 2-player PIC-vs-SHR game driven by an
//     explicit intent log. START -> Play -> Activate (specialty advance, away
//     teams, market buy, warp, attack + REACTION) -> mission completion ->
//     END_TURN/PASS -> clean-up choices. The single-Stardate track exhausts on
//     turn 1, Resolution's extra-turn budget finishes the round, and the game
//     ends by FINAL_SCORING with a HAND-COMPUTED per-seat breakdown.
//   Game 2 (Burn): a different seed where seat 0 activates the Captain's
//     "take the last INCIDENT" op, emptying the Incident deck -> BURN wins.
//
// Every RESOLVE_CHOICE is validated with validateChoice before applying (the
// honest-choices rule); assertSerialisable runs after every reduce; and the
// identical script + seed is replayed from scratch and byte-compared.

import { describe, expect, it } from 'vitest'
import type { CardDef } from '../data/schema'
import type { DeckId, FocusIcon, Suit, TraitId } from '../data/ids'
import type { Effect, Operation } from './resolver/nodes'
import type { GameState, MissionState } from './state'
import { player } from './state'
import {
	setup,
	type CardCatalog,
	type SetupConfig,
	type StardateSpec,
	type BoardMissions,
} from './setup'
import { reduce, legalIntents, type Intent } from './intents'
import { validateChoice, type PendingChoice } from './resolver/choices'
import { canPlay, canActivate, completableMissions } from './queries/legality'
import { assertSerialisable } from './invariants'
import type { CardInstanceId } from './ids'
import { TEST_TRACKS_BASIC } from './resolver/testUtils'

// ---------------------------------------------------------------------------
// Fixture: a small 2-player catalog. ~8 hand-written cards per crew deck plus a
// handful of Market / Location / Encounter / Incident / Stardate faces.
// ---------------------------------------------------------------------------

function op(
	type: Operation['type'],
	effect: Effect,
	extra: Partial<Pick<Operation, 'costsAction' | 'isAttack' | 'trigger'>> = {},
): Operation {
	return {
		type,
		costsAction: extra.costsAction ?? false,
		isAttack: extra.isAttack ?? false,
		trigger: extra.trigger,
		effect,
		text: 'm1 fixture op',
	}
}

interface DefSpec {
	id: string
	suit: Suit
	deck: DeckId
	startPosition?: CardDef['startPosition'] | null | undefined
	vp?: number | undefined
	vpAsterisk?: boolean | undefined
	focus?: FocusIcon | null | undefined
	traits?: TraitId[] | undefined
	awayTeams?: number | undefined
	shipToken?: string | undefined
	locationTier?: 'STARTING' | 'ADVANCED' | undefined
	operations?: Operation[] | undefined
}

function cd(spec: DefSpec): CardDef {
	return {
		id: spec.id,
		cardId: null,
		name: spec.id,
		suit: spec.suit,
		deck: spec.deck,
		traits: spec.traits ?? [],
		skills: [],
		variableSkill: undefined,
		focus: spec.focus ?? null,
		vp: spec.vp ?? 0,
		vpAsterisk: spec.vpAsterisk ?? false,
		startPosition: spec.startPosition ?? null,
		developmentCost: null,
		operations: spec.operations ?? [],
		...(spec.awayTeams !== undefined ? { awayTeams: spec.awayTeams } : {}),
		...(spec.shipToken !== undefined ? { shipToken: spec.shipToken } : {}),
		...(spec.locationTier !== undefined
			? { locationTier: spec.locationTier }
			: {}),
	}
}

const gain = (res: 'DIL' | 'LAT' | 'GLO', amount = 1): Effect => ({
	k: 'GAIN_RESOURCE',
	res,
	amount,
})

const neutralZone = (): Effect => ({
	k: 'SEND_AWAY_TEAM',
	count: 3,
	target: {
		zones: [
			{ k: 'NEUTRAL_ZONE', slot: 0 },
			{ k: 'NEUTRAL_ZONE', slot: 1 },
			{ k: 'NEUTRAL_ZONE', slot: 2 },
		],
	},
})
const warpToNZ = (): Effect => ({
	k: 'WARP',
	ship: { zones: ['IN_PLAY'], seat: 'SELF', filter: { ids: ['pic-ship-2'] } },
	to: {
		zones: [
			{ k: 'NEUTRAL_ZONE', slot: 0 },
			{ k: 'NEUTRAL_ZONE', slot: 1 },
			{ k: 'NEUTRAL_ZONE', slot: 2 },
		],
	},
})
const marketBuy = (): Effect => ({
	k: 'PAY_THEN',
	cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 1 },
	body: { k: 'GAIN_CARD', suits: ['CARGO', 'ALLY'] },
})
const endgamePerAlly: Effect = {
	k: 'SCORE_VP',
	amount: {
		k: 'COUNT',
		query: { zones: ['ALL_OWNED'], seat: 'SELF', filter: { suits: ['ALLY'] } },
	},
}

function makeCatalog(): CardCatalog {
	const common: CardDef[] = [
		// Market faces: two per suit so a buy can refill.
		cd({ id: 'cm-person-01', suit: 'PERSON', deck: 'COMMON', vp: 1 }),
		cd({ id: 'cm-person-02', suit: 'PERSON', deck: 'COMMON', vp: 1 }),
		cd({ id: 'cm-cargo-01', suit: 'CARGO', deck: 'COMMON', vp: 1 }),
		cd({ id: 'cm-cargo-02', suit: 'CARGO', deck: 'COMMON', vp: 1 }),
		cd({
			id: 'cm-ship-01',
			suit: 'SHIP',
			deck: 'COMMON',
			shipToken: 'cm-ship-01',
		}),
		cd({
			id: 'cm-ship-02',
			suit: 'SHIP',
			deck: 'COMMON',
			shipToken: 'cm-ship-02',
		}),
		cd({ id: 'cm-ally-01', suit: 'ALLY', deck: 'COMMON', vp: 2 }), // bought by PIC in Game 1
		cd({ id: 'cm-ally-02', suit: 'ALLY', deck: 'COMMON' }),
		// Encounter + Incident (the single Incident keeps the Burn off until taken).
		cd({ id: 'cm-enc-01', suit: 'ENCOUNTER', deck: 'COMMON' }),
		cd({ id: 'cm-inc-01', suit: 'INCIDENT', deck: 'COMMON' }),
		// Locations: 4 Starting (3 Neutral Zone + 1 on top of the deck) + 2 Advanced.
		cd({
			id: 'cm-loc-s-01',
			suit: 'LOCATION',
			deck: 'COMMON',
			locationTier: 'STARTING',
		}),
		cd({
			id: 'cm-loc-s-02',
			suit: 'LOCATION',
			deck: 'COMMON',
			locationTier: 'STARTING',
		}),
		cd({
			id: 'cm-loc-s-03',
			suit: 'LOCATION',
			deck: 'COMMON',
			locationTier: 'STARTING',
		}),
		cd({
			id: 'cm-loc-s-04',
			suit: 'LOCATION',
			deck: 'COMMON',
			locationTier: 'STARTING',
		}),
		cd({
			id: 'cm-loc-a-01',
			suit: 'LOCATION',
			deck: 'COMMON',
			locationTier: 'ADVANCED',
		}),
		cd({
			id: 'cm-loc-a-02',
			suit: 'LOCATION',
			deck: 'COMMON',
			locationTier: 'ADVANCED',
		}),
	]

	// One Stardate card, printed Glory 1: the very first Clean-up empties it and
	// triggers a Resolution; the extra-turn budget then finishes the round.
	const stardates: StardateSpec[] = [
		{
			id: 'sd-001',
			name: 'sd-001',
			sequence: 1,
			glory: 1,
			modes: ['TWO_PLAYER'],
			def: cd({
				id: 'sd-001',
				suit: 'DIRECTIVE',
				deck: 'COMMON',
				operations: [op('CLEANUP', { k: 'WIPE_MARKET' })],
			}),
		},
	]

	const pic: CardDef[] = [
		cd({
			id: 'pic-captain',
			suit: 'CAPTAIN',
			deck: 'PIC',
			awayTeams: 4,
			focus: 'FOCUS_RESEARCH',
			operations: [
				op('ACTIVATION', neutralZone(), { costsAction: true }), //        [0] T1: send 3 Away Teams
				op('ACTIVATION', gain('DIL'), { costsAction: true, isAttack: true }), // [1] T3: [attack] -> REACTION window
				op('ENDGAME', endgamePerAlly), //                                   [2] 1 VP per ALLY owned
				op(
					'ACTIVATION',
					{ k: 'TAKE', deck: 'INCIDENT', count: 1 },
					{ costsAction: true },
				), // [3] Game 2: the Burn
			],
		}),
		cd({
			id: 'pic-ship-1',
			suit: 'SHIP',
			deck: 'PIC',
			startPosition: 'DEPLOYED',
			shipToken: 'pic-ship-1',
			focus: 'FOCUS_RESEARCH',
			vp: 2,
			operations: [
				op('ACTIVATION', marketBuy(), { costsAction: true }), //            [0] T3: market buy
				op(
					'ACTIVATION',
					{ k: 'ADVANCE_SPECIALTY', specialty: 'RESEARCH', amount: 4 },
					{ costsAction: true },
				), // [1] T1: RESEARCH 4
			],
		}),
		cd({
			id: 'pic-ship-2',
			suit: 'SHIP',
			deck: 'PIC',
			startPosition: 'DEPLOYED',
			shipToken: 'pic-ship-2',
			vp: 1,
			operations: [
				op('ACTIVATION', warpToNZ(), { costsAction: true }),
				op('ENDGAME', { k: 'SCORE_VP', amount: 1 }),
			],
		}),
	]
	for (let i = 1; i <= 5; i++) {
		pic.push(
			cd({
				id: `pic-av-${String(i).padStart(2, '0')}`,
				suit: 'PERSON',
				deck: 'PIC',
				startPosition: 'AVAILABLE',
				operations: [op('PLAY', gain('DIL'))],
			}),
		)
	}
	// pic-av-05 doubles as the burn tracer in one fixture (never played in Game 1).
	pic[pic.length - 1] = cd({
		id: 'pic-av-05',
		suit: 'PERSON',
		deck: 'PIC',
		startPosition: 'AVAILABLE',
		operations: [op('PLAY', { k: 'TAKE', deck: 'INCIDENT', count: 1 })],
	})

	const shr: CardDef[] = [
		cd({
			id: 'shr-captain',
			suit: 'CAPTAIN',
			deck: 'SHR',
			awayTeams: 2,
			focus: 'FOCUS_MILITARY',
			operations: [
				op(
					'ACTIVATION',
					{
						k: 'SEND_AWAY_TEAM',
						count: 2,
						target: {
							zones: [
								{ k: 'NEUTRAL_ZONE', slot: 0 },
								{ k: 'NEUTRAL_ZONE', slot: 1 },
								{ k: 'NEUTRAL_ZONE', slot: 2 },
							],
						},
					},
					{ costsAction: true },
				), // [0] T2: 2 Away Teams
				op('ACTIVATION', gain('DIL'), { costsAction: true }), //             [1]
				op('REACTION', gain('GLO'), { trigger: { on: 'ATTACKED' } }), //      [2] T3: when attacked -> +1 GLO
				op(
					'ACTIVATION',
					{ k: 'TAKE', deck: 'INCIDENT', count: 1 },
					{ costsAction: true },
				), // [3]
			],
		}),
		cd({
			id: 'shr-ship',
			suit: 'SHIP',
			deck: 'SHR',
			startPosition: 'DEPLOYED',
			shipToken: 'shr-ship',
			focus: 'FOCUS_MILITARY',
			vp: 2,
			operations: [op('ENDGAME', { k: 'SCORE_VP', amount: 1 })],
		}),
		cd({
			id: 'shr-av-01',
			suit: 'PERSON',
			deck: 'SHR',
			startPosition: 'AVAILABLE',
			vpAsterisk: true,
			operations: [
				op('SPECIAL', { k: 'SCORE_VP', amount: 2 }),
				op('PLAY', gain('DIL')),
			],
		}),
	]
	for (let i = 2; i <= 5; i++) {
		shr.push(
			cd({
				id: `shr-av-${String(i).padStart(2, '0')}`,
				suit: 'PERSON',
				deck: 'SHR',
				startPosition: 'AVAILABLE',
				vp: 1,
				operations: [op('PLAY', gain('DIL'))],
			}),
		)
	}

	const never: MissionState['goal'] = {
		k: 'COUNT_AT_LEAST',
		query: { zones: [{ k: 'FLEET', seat: 0 }] },
		value: 99,
	}
	// Each mission owns fresh goal/reward objects: assertSerialisable treats a
	// shared reference (even between two missions) as a serialisation cycle.
	const missions = (
		i: 0 | 1 | 2,
		goal: MissionState['goal'],
		vp: number,
	): MissionState => ({
		index: i,
		goal: structuredClone(goal),
		reward: { k: 'NOOP' },
		vp,
		completed: false,
	})
	const commonBoard = (
		mk: (i: 0 | 1 | 2, goal: MissionState['goal'], vp: number) => MissionState,
	): BoardMissions => ({
		// fixture glyphs with ×1 at step 0 on both sides (hand-computed totals)
		tracks: { basic: TEST_TRACKS_BASIC, advanced: TEST_TRACKS_BASIC },
		basic: [
			mk(
				0,
				{
					k: 'COUNT_AT_LEAST',
					query: {
						zones: ['IN_PLAY'],
						seat: 'SELF',
						filter: { suits: ['SHIP'] },
					},
					value: 1,
				},
				4,
			),
			mk(1, never, 5),
			mk(2, never, 6),
		],
		advanced: [
			mk(0, { k: 'CONTROLS_LOCATION', count: 1 }, 4),
			mk(1, never, 5),
			mk(2, never, 6),
		],
	})
	const boards: Partial<Record<DeckId, BoardMissions>> = {
		PIC: commonBoard(missions),
		SHR: commonBoard(missions),
	}

	return { defs: [...common, ...pic, ...shr], stardates, boards }
}

const catalog = makeCatalog()

function config(seed: number): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: 'PIC', boardSide: 'ADVANCED' },
			{ deck: 'SHR', boardSide: 'BASIC' },
		],
		seed,
	}
}

// ---------------------------------------------------------------------------
// Driver helpers
// ---------------------------------------------------------------------------

const zoneIids = (s: GameState, key: string): CardInstanceId[] =>
	s.zones[key] ?? []
const NZ = (s: GameState, slot: 0 | 1 | 2): CardInstanceId =>
	zoneIids(s, `NEUTRAL_ZONE:${slot}`)[0]!
const findDef = (
	s: GameState,
	key: string,
	def: string,
): CardInstanceId | undefined =>
	zoneIids(s, key).find((i) => s.cards[i]!.def === def)

/** Locate a playable hand card for `seat` whose PLAY op is the plain gain-DIL
 *  filler (never the burn-tracer). Deterministic: driven off legalIntents. */
function playableFiller(
	s: GameState,
	_seat: 0 | 1,
	skip: string,
): { iid: CardInstanceId; opIndex: number } {
	// legalIntents is always produced for the active seat; skip the burn tracer.
	for (const i of legalIntents(s)) {
		if (
			i.t === 'PLAY_CARD' &&
			s.cards[i.iid]!.def !== skip &&
			s.cards[i.iid]!.def !== 'pic-av-05'
		) {
			return { iid: i.iid, opIndex: i.operationIndex }
		}
	}
	throw new Error(`no playable non-${skip} filler in hand`)
}

/** Minimal honest driver: every reduce is followed by assertSerialisable and
 *  every RESOLVE_CHOICE passes validateChoice first. */
class Driver {
	s: GameState
	readonly seed: number
	constructor(seed: number) {
		this.seed = seed
		this.s = setup(config(seed), catalog)
		assertSerialisable(this.s)
		if (this.s.startingSeat !== 0) {
			throw new Error(
				`m1-exit: seed ${seed} does not start on seat 0 (got ${this.s.startingSeat})`,
			)
		}
	}
	/** Reduce one intent; assertSerialisable the result. */
	go(intent: Intent): GameState {
		const r = reduce(this.s, intent)
		this.s = r.state
		assertSerialisable(this.s)
		return this.s
	}
	/** The current pending choice, optionally asserting its kind. */
	c(kind?: PendingChoice['k']): PendingChoice {
		const c = this.s.pendingChoice
		if (c === null)
			throw new Error('m1-exit: expected a pendingChoice, got none')
		if (kind !== undefined && c.k !== kind) {
			throw new Error(`m1-exit: expected choice kind ${kind}, got ${c.k}`)
		}
		return c
	}
	/** Resolve the pending choice with `selection`, after validateChoice. */
	settle(selection: unknown, kind?: PendingChoice['k']): GameState {
		const c = this.c(kind)
		const v = validateChoice(this.s, c.id, selection)
		if (!v.ok)
			throw new Error(`m1-exit: scripted selection is ILLEGAL: ${v.reason}`)
		return this.go({ t: 'RESOLVE_CHOICE', choiceId: c.id, selection })
	}
}

// ---------------------------------------------------------------------------
// Game 1 — Stardate-track exhaustion -> Resolution -> final scoring.
// Hand-computed expectation on the deterministic end state:
//
//   PIC (advanced): glory 2 | neutral tokens 1 | endgame 1+1 | printed 5 |
//                      focus 2×2 | missions 4                        = 18
//   SHR  (basic):    glory 2 | neutral tokens 2 | endgame 1 | printed 8 |
//                      focus 2×1 | missions 0                         = 15
// ---------------------------------------------------------------------------

function playGame1(seed: number): GameState {
	const D = new Driver(seed)
	let s = D.s
	expect(s.phase).toEqual({ k: 'SETUP' })

	// ---------- Turn 1 — PIC (seat 0) ----------
	s = D.go({ t: 'START' })
	expect(s.phase.k).toBe('ACTION')
	expect(s.activeSeat).toBe(0)

	// PLAY_CARD: a filler from hand (gain 1 DIL), ends in Discard at clean-up.
	const { iid: filler1, opIndex: o1 } = playableFiller(s, 0, '')
	const playCheck = canPlay(s, 0, filler1)
	expect(playCheck.ok).toBe(true)
	s = D.go({ t: 'PLAY_CARD', iid: filler1, operationIndex: o1 })
	expect(s.cards[filler1]!.zone).toEqual({ k: 'STAGING', seat: 0 })
	expect(player(s, 0).resources.DIL).toBe(2) // setup 1 + filler

	// ACTIVATE pic-ship-1 #1: ADVANCE_SPECIALTY RESEARCH -> 4 (focus multiplier 2).
	const ship1 = findDef(s, 'FLEET:0', 'pic-ship-1')!
	expect(canActivate(s, 0, ship1, 1).ok).toBe(true)
	s = D.go({ t: 'ACTIVATE', iid: ship1, operationIndex: 1 })
	expect(player(s, 0).specialties.RESEARCH).toBe(4)

	// ACTIVATE pic-captain #0: send 3 Away Teams to the Neutral Zone -> CHOOSE_LOCATION.
	const picCap = findDef(s, 'CAPTAIN:0', 'pic-captain')!
	s = D.go({ t: 'ACTIVATE', iid: picCap, operationIndex: 0 })
	const locationChoice = D.c('CHOOSE_LOCATION') as PendingChoice & {
		candidates: CardInstanceId[]
	}
	expect(locationChoice.candidates).toHaveLength(3)
	s = D.settle(NZ(s, 0), 'CHOOSE_LOCATION')
	expect(s.awayTeamsAt[NZ(s, 0)]?.[0]).toBe(3)

	// END_TURN -> clean-up Glory placement. The Stardate keeps its last token
	// until the Market card is chosen.
	s = D.go({ t: 'END_TURN' })
	expect(s.resolutionTriggered).toBe(false)
	expect(s.stardates.gloryOnTop).toBe(1)
	// put the token on the ALLY offer (PIC buys it later).
	const allyOffer = zoneIids(s, 'MARKET_OFFER:ALLY')[0]!
	const glory1 = D.c('CHOOSE_CARDS')
	const marketPick = (glory1 as { candidates: CardInstanceId[] }).candidates
	expect(marketPick).toContain(allyOffer)
	s = D.settle([allyOffer], 'CHOOSE_CARDS')
	expect(s.cards[allyOffer]!.resourceTokens.GLO).toBe(1)
	// Stardate #1 empties -> Resolution triggered.
	expect(s.resolutionTriggered).toBe(true)
	expect(s.stardates.pile).toHaveLength(1)
	expect(s.stardates.gloryOnTop).toBe(0)
	// voluntary hand discard: keep everything.
	s = D.settle([], 'CHOOSE_CARDS')
	expect(s.phase.k).toBe('ACTION')
	expect(s.activeSeat).toBe(1)
	expect(s.turnNumber).toBe(2)
	// turnsAfterResolution budget: mid-round trigger -> finish the round + 2.
	expect(s.turnsAfterResolution).toBe(3)

	// ---------- Turn 2 — SHR (seat 1) ----------
	const { iid: filler2, opIndex: o2 } = playableFiller(s, 1, '')
	s = D.go({ t: 'PLAY_CARD', iid: filler2, operationIndex: o2 })

	// ACTIVATE shr-captain #0: send 2 Away Teams to Neutral Zone slot 1.
	const shrCap = findDef(s, 'CAPTAIN:1', 'shr-captain')!
	s = D.go({ t: 'ACTIVATE', iid: shrCap, operationIndex: 0 })
	s = D.settle(NZ(s, 1), 'CHOOSE_LOCATION')
	expect(s.awayTeamsAt[NZ(s, 1)]?.[1]).toBe(2)

	// COMPLETE_MISSION 0 (own in-play SHIP — always met).
	expect(completableMissions(s, 1)).toContain(0)
	s = D.go({ t: 'COMPLETE_MISSION', index: 0 })
	expect(player(s, 1).missions[0]!.completed).toBe(true)

	// PASS = the ACTION -> CLEAN-UP boundary (both PASS and END_TURN work).
	s = D.go({ t: 'PASS' })
	s = D.settle([zoneIids(s, 'MARKET_OFFER:PERSON')[0]!], 'CHOOSE_CARDS') // Glory -> PERSON offer
	s = D.settle([], 'CHOOSE_CARDS') // hand discard: keep

	// Next up: PIC's Resolution turn — but first the CONTROL step notices
	// PIC has 3 Away Teams on a secured Neutral Location (rules/03 §3.4).
	expect(s.pendingChoice?.k).toBe('CHOOSE_LOCATION')

	// ---------- Turn 3 — PIC ----------
	// Take control of the secured Location (real control activity).
	const controlChoice = D.c('CHOOSE_LOCATION') as PendingChoice & {
		candidates: CardInstanceId[]
	}
	expect(controlChoice.candidates).toContain(NZ(s, 0))
	const slot0 = NZ(s, 0)
	s = D.settle(slot0, 'CHOOSE_LOCATION')
	expect(s.cards[slot0]!.zone).toEqual({ k: 'LOCATION_AREA', seat: 0 })
	// Away Teams returned to the Captain; slot 0 refilled from the Location deck.
	expect(s.players[0].awayTeamsInPool).toBe(4)
	expect(s.cards[NZ(s, 0)]!.def).not.toBe(s.cards[slot0]!.def)
	expect(s.phase.k).toBe('ACTION')

	// COMPLETE_MISSION 0 (now controlling a Location — goal met).
	expect(completableMissions(s, 0)).toContain(0)
	s = D.go({ t: 'COMPLETE_MISSION', index: 0 })
	expect(player(s, 0).missions[0]!.completed).toBe(true)

	// ACTIVATE pic-ship-1 #0: market buy (pay 1 DIL, gain CARGO or ALLY).
	s = D.go({ t: 'ACTIVATE', iid: ship1, operationIndex: 0 })
	s = D.settle('ALLY', 'CHOOSE_SUIT') // which suit? ALLY -> transfer the Glory
	const allyOffer2 = zoneIids(s, 'MARKET_OFFER:ALLY')[0]!
	s = D.settle([allyOffer2], 'CHOOSE_CARDS') // pick the faceup offer (1 GLO)
	s = D.settle('DISCARD', 'CHOOSE_DESTINATION') // where? Discard
	expect(s.cards[allyOffer2]!.owner).toBe(0)
	expect(player(s, 0).resources.GLO).toBe(2) // setup 1 + the Glory token on the ALLY
	expect(s.players[0].resources.DIL).toBe(1) // 3 - the buy cost

	// ACTIVATE pic-ship-2 #0: warp its token to a Neutral Location (1 VP at end).
	const ship2 = findDef(s, 'FLEET:0', 'pic-ship-2')!
	s = D.go({ t: 'ACTIVATE', iid: ship2, operationIndex: 0 })
	// Exactly one deployable ship → the picker auto-selects it; only the
	// destination is offered.
	s = D.settle(NZ(s, 1), 'CHOOSE_LOCATION') // park it beside SHR's Away Teams
	expect(s.cards[ship2]!.shipTokenAt).toBe(NZ(s, 1))

	// ACTIVATE pic-captain #1: [attack] -> SHR's REACTION fires (gain 1 GLO).
	s = D.go({ t: 'ACTIVATE', iid: picCap, operationIndex: 1 })
	const react = D.c('OPTIONAL_TRIGGERS')
	const offered = (react as { offered: { card: CardInstanceId }[] }).offered
	expect(offered).toHaveLength(1)
	expect(s.cards[offered[0]!.card]!.def).toBe('shr-captain')
	s = D.settle((react as { offered: unknown[] }).offered, 'OPTIONAL_TRIGGERS')
	expect(player(s, 1).resources.GLO).toBe(2) // setup 1 + reaction
	expect(s.pendingChoice).toBeNull()

	// END_TURN -> clean-up choices (Glory placement onto PERSON, keep hand).
	s = D.go({ t: 'END_TURN' })
	s = D.settle([zoneIids(s, 'MARKET_OFFER:PERSON')[0]!], 'CHOOSE_CARDS')
	s = D.settle([], 'CHOOSE_CARDS')
	expect(s.phase.k).toBe('ACTION')
	expect(s.activeSeat).toBe(1)
	expect(s.turnNumber).toBe(4)

	// ---------- Turn 4 — SHR (last turn) ----------
	const { iid: filler4, opIndex: o4 } = playableFiller(s, 1, '')
	s = D.go({ t: 'PLAY_CARD', iid: filler4, operationIndex: o4 })
	// SHR's Captain reacted on turn 3, so it is still exhausted: a card only
	// refreshes in its owner's Clean-up (rules/03 §3.6.7) — no captain op1 now.
	expect(s.cards[shrCap]!.exhausted).toBe(true)
	expect(canActivate(s, 1, shrCap, 1).ok).toBe(false)
	s = D.go({ t: 'PASS' }) // ACTION -> CLEAN-UP
	s = D.settle([zoneIids(s, 'MARKET_OFFER:PERSON')[0]!], 'CHOOSE_CARDS')
	// The final hand-discard resolve runs Clean-up -> REFRESH -> handOffTurn, and
	// the extra-turn budget hits 0 -> FINAL_SCORING installed by the run loop.
	s = D.settle([], 'CHOOSE_CARDS')

	// ---------- Game over ----------
	expect(s.result?.kind).toBe('COMPLETE')
	const res = s.result
	if (res === null || res?.kind !== 'COMPLETE')
		throw new Error('expected COMPLETE')
	expect(res.scoreboard.winners).toEqual([0])
	expect(s.turnsTaken).toEqual([2, 2])
	return s
}

describe('M1 exit — Game 1 (Resolution path, full scripted game)', () => {
	it('plays setup -> turn loop -> control/market -> endgame scoring with hand-computed totals', () => {
		const s = playGame1(2)
		const res = s.result
		if (res === null || res.kind !== 'COMPLETE')
			throw new Error('expected COMPLETE')
		const [p, sh] = res.scoreboard.breakdown

		// ---- PIC, hand-computed: 18 ----
		expect(p.glory).toBe(2)
		expect(p.neutralTokens).toEqual({ count: 1, vp: 1 }) // warped pic-ship-2 at slot 1
		expect(p.endgame).toHaveLength(2) // pic-captain: 1 per ALLY + pic-ship-2: fixed 1
		const picEndgame = [...p.endgame].sort((a, b) =>
			s.cards[a.card]!.def < s.cards[b.card]!.def ? -1 : 1,
		)
		expect(s.cards[picEndgame[0]!.card]!.def).toBe('pic-captain')
		expect(s.cards[picEndgame[1]!.card]!.def).toBe('pic-ship-2')
		for (const e of picEndgame) {
			expect(e.label).toBe('m1 fixture op')
			expect(e.vp).toBe(1)
		}
		expect(
			p.printedVp.reduce((n: number, e: { vp: number }) => n + e.vp, 0),
		).toBe(5) // ship1 2 + ship2 1 + bought ALLY 2
		expect(p.focus).toEqual([
			{ specialty: 'RESEARCH', multiplier: 2, cards: 2, vp: 4 },
		])
		expect(p.missions).toEqual([{ index: 0, vp: 4 }])
		expect(p.missionsCompleted).toBe(1)
		expect(p.focusSuppressed).toBe(false)
		expect(p.total).toBe(18)

		// ---- SHR, hand-computed: 15 ----
		expect(sh.glory).toBe(2)
		expect(sh.neutralTokens).toEqual({ count: 2, vp: 2 }) // 2 Away Teams at slot 1
		expect(sh.endgame).toHaveLength(1) // shr-ship: fixed 1
		expect(s.cards[sh.endgame[0]!.card]!.def).toBe('shr-ship')
		expect(sh.endgame[0]!.label).toBe('m1 fixture op')
		expect(sh.endgame[0]!.vp).toBe(1)
		expect(
			sh.printedVp.reduce((n: number, e: { vp: number }) => n + e.vp, 0),
		).toBe(8) // ship 2 + asterisk 2 + four playables 1ea
		expect(sh.focus).toEqual([
			{ specialty: 'MILITARY', multiplier: 1, cards: 2, vp: 2 },
		])
		expect(sh.missions).toEqual([]) // BASIC board side: no mission VP
		expect(sh.missionsCompleted).toBe(1)
		expect(sh.focusSuppressed).toBe(false)
		expect(sh.total).toBe(15)
	})

	it('is deterministic: replaying the identical script + seed byte-matches at game over', () => {
		const a = playGame1(2)
		const b = playGame1(2)
		expect(JSON.stringify(a)).toBe(JSON.stringify(b))
		expect(a).toEqual(b)
	})
})

// ---------------------------------------------------------------------------
// Game 2 — Incident-deck exhaustion -> Burn wins (different seed).
// ---------------------------------------------------------------------------

function playGame2(seed: number): GameState {
	const D = new Driver(seed)
	let s = D.s
	s = D.go({ t: 'START' })
	// The Burn is the fastest honest path: take the single INCIDENT from the
	// deck on the very first action (rules/12 §12.11). Taker = seat 0 loses.
	const cap = findDef(
		s,
		`CAPTAIN:${s.activeSeat}`,
		s.activeSeat === 0 ? 'pic-captain' : 'shr-captain',
	)!
	const takeOp = 3
	expect(canActivate(s, s.activeSeat, cap, takeOp).ok).toBe(true)
	s = D.go({ t: 'ACTIVATE', iid: cap, operationIndex: takeOp })
	// checkEndgame fires inside the run loop as soon as the deck empties.
	expect(s.result?.kind).toBe('COMPLETE')
	const res2 = s.result
	if (res2 === null || res2?.kind !== 'COMPLETE')
		throw new Error('expected COMPLETE')
	expect(res2.scoreboard.incidentCounts).toEqual([1, 0])
	expect(res2.scoreboard.winners).toEqual([1]) // fewer INCIDENTs wins (Burn)
	return s
}

describe('M1 exit — Game 2 (Burn path, Incident deck exhausted)', () => {
	it('seat 0 empties the Incident deck -> BURN supersedes score, seat 1 wins', () => {
		const s = playGame2(2)
		expect(s.turnsTaken).toEqual([0, 0]) // Burn fires mid Turn 1, no turn completed
		const res = s.result
		if (res === null || res.kind !== 'COMPLETE')
			throw new Error('expected COMPLETE')
		const [p, sh] = res.scoreboard.breakdown
		// Few played cards: totals are tiny and purely from setup (hand-computed).
		expect(p.total).toBe(5)
		expect(sh.total).toBe(10)
	})

	it('is deterministic on replay', () => {
		expect(JSON.stringify(playGame2(2))).toBe(JSON.stringify(playGame2(2)))
	})
})
