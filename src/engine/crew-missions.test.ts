// The box-1 crew boards (src/data/cards/boards/*.json): the 18 STCC missions
// 1PIC/1KOL/1SHR/1SIS/1SEL/1BUR M1..M3 and the per-crew, per-side track
// multipliers. Pins the mission-goal forms they need (SAME_SHIP counts with
// distinct cards and "N different of", DIFFERENT_SPECIES with exclusions and
// per-card ALIEN/TRANSCENDENT), the goal-agnostic witness dismissal (only the
// contributing beamed cards), the attack-flagged reward, the enlist-reward
// variants and the Glory-from-supply gain — then one test per mission against
// the real board data.

import { beforeAll, describe, expect, it } from 'vitest'
import {
	fresh,
	register,
	makeDef,
	op,
	place,
	ID,
	setResources,
	setSpecialty,
} from './resolver/testUtils'
import { loadCatalog } from '../data/catalog'
import { canComplete } from './queries/legality'
import { evalPredicate } from './queries/resolveQuery'
import { reduce } from './intents'
import { highestMultiplierReached, score } from './scoring'
import { setup, type CardCatalog, type SetupConfig } from './setup'
import {
	player,
	type GameEvent,
	type GameState,
	type MissionState,
	type Phase,
} from './state'
import type { PendingChoice } from './resolver/choices'
import type { Predicate, Seat, ZoneRef } from './resolver/queries'
import type { Effect } from './resolver/nodes'
import type { CardDef } from '../data/schema'
import type { DeckId, Suit, TraitId } from '../data/ids'
import type { CardInstanceId } from './ids'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let catalog: CardCatalog
beforeAll(async () => {
	catalog = await loadCatalog()
})

/** The real mission `n` (1-based) of `deck`'s Advanced side. */
function mission(deck: DeckId, n: 1 | 2 | 3): MissionState {
	return structuredClone(catalog.boards[deck]!.advanced[n - 1]!)
}

const defined = new Set<string>()
/** Register (once) a synthetic card: `id` doubles as its name unless given. */
function card(
	id: string,
	suit: Suit,
	traits: TraitId[] = [],
	extra: Partial<CardDef> = {},
): string {
	if (!defined.has(id)) {
		defined.add(id)
		register([{ ...makeDef({ id, suit, traits, operations: [] }), ...extra }])
	}
	return id
}

let n = 0
const nextId = (p: string): CardInstanceId => ID(`${p}${n++}`)

/** Seat `seat` parked in its ACTION step with `missions` on `side`. */
function board(
	missions: MissionState[],
	side: 'BASIC' | 'ADVANCED' = 'ADVANCED',
	seat: Seat = 0,
): GameState {
	const s = fresh()
	const players = s.players.map((pl) =>
		pl.seat === seat ? { ...pl, missions, boardSide: side } : pl,
	) as GameState['players']
	return {
		...s,
		players,
		activeSeat: seat,
		phase: { k: 'ACTION' } as Phase,
	}
}

/** A table under construction: `t.s` is the state, the helpers place cards
 *  and return their instance ids. */
class Table {
	constructor(public s: GameState) {}

	/** Put a card for `seat` into `zone`. */
	put(
		def: string,
		zone: ZoneRef,
		seat: Seat | null = 0,
		extra?: Partial<GameState['cards'][string]>,
	): CardInstanceId {
		const iid = nextId(def)
		this.s = place(this.s, def, iid, zone, seat, extra)
		return iid
	}

	/** Deploy a SHIP (optionally with its token at Location `at`). */
	ship(def: string, seat: Seat = 0, at?: CardInstanceId): CardInstanceId {
		return this.put(def, { k: 'FLEET', seat }, seat, {
			...(at !== undefined ? { shipTokenAt: at } : {}),
		})
	}

	/** Beam a card to `host`. */
	beam(def: string, host: CardInstanceId, seat: Seat = 0): CardInstanceId {
		return this.put(def, { k: 'BEAMED', host }, seat, { beamedTo: host })
	}
}

type Answer = (c: PendingChoice) => unknown

/** The first legal answer to a pending choice (CONFIRM = yes). */
function firstLegal(c: PendingChoice): unknown {
	switch (c.k) {
		case 'CONFIRM':
			return true
		case 'CHOOSE_OPTION':
			return { key: c.options.find((o) => o.enabled)!.key }
		case 'CHOOSE_CARDS': {
			const off = new Set((c.disabled ?? []).map((d) => d.iid))
			const legal = c.candidates.filter((iid) => !off.has(iid))
			return legal.slice(0, Math.max(c.min, 1))
		}
		case 'CHOOSE_LOCATION':
			return c.candidates[0]
		case 'CHOOSE_WITNESS':
			return c.sets[0]
		case 'CHOOSE_AMOUNT':
			return c.max
		default:
			throw new Error(`test: no default answer for ${c.k}`)
	}
}

/** Complete mission `index` via the intent layer, answering every choice. */
function complete(
	s0: GameState,
	index: number,
	answer: Answer = firstLegal,
): { state: GameState; events: GameEvent[]; asked: PendingChoice[] } {
	const events: GameEvent[] = []
	const asked: PendingChoice[] = []
	let r = reduce(s0, { t: 'COMPLETE_MISSION', index })
	let s = r.state
	events.push(...r.events)
	for (let guard = 0; s.pendingChoice !== null; guard++) {
		if (guard > 50) throw new Error('test: too many choices')
		const c = s.pendingChoice
		asked.push(c)
		r = reduce(s, {
			t: 'RESOLVE_CHOICE',
			choiceId: c.id,
			selection: answer(c) ?? firstLegal(c),
		})
		s = r.state
		events.push(...r.events)
	}
	return { state: s, events, asked }
}

/** A current Stardate card holding 5 Glory. */
function withStardate(s0: GameState): GameState {
	const t = new Table(s0)
	const top = t.put(
		card('m-stardate', 'DIRECTIVE'),
		{ k: 'STARDATE_PILE' },
		null,
	)
	return { ...t.s, stardates: { ...t.s.stardates, pile: [top], gloryOnTop: 5 } }
}

const goalOf = (s: GameState, pred: Predicate, seat: Seat = 0): boolean =>
	evalPredicate(s, pred, {
		actor: seat,
		source: '' as CardInstanceId,
		bindings: {},
	})

const zone = (s: GameState, key: string): CardInstanceId[] => s.zones[key] ?? []
const where = (s: GameState, iid: CardInstanceId): string =>
	s.cards[iid]!.zone.k

// Common synthetic cards
const SHIP = card('m-ship', 'SHIP')
const ALLY = card('m-ally', 'ALLY')
const KLINGON = card('m-klingon', 'PERSON', ['KLINGON'])
const ROMULAN = card('m-romulan', 'PERSON', ['ROMULAN'])
const HYBRID = card('m-hybrid', 'PERSON', ['ROMULAN', 'KLINGON'])
const KSHIP = card('m-kship', 'SHIP', ['KLINGON'])
const HUMAN = card('m-human', 'PERSON', ['HUMAN'])
const VULCAN = card('m-vulcan', 'PERSON', ['VULCAN'])
const ANDORIAN = card('m-andorian', 'PERSON', ['ANDORIAN'])
const TELLARITE = card('m-tellarite', 'PERSON', ['TELLARITE'])
const VULCAN_AMB = card('m-vulcan-amb', 'PERSON', ['VULCAN', 'AMBASSADOR'])
const ALIEN = card('m-alien', 'PERSON', ['ALIEN'])
const TRANSC = card('m-transc', 'PERSON', ['TRANSCENDENT'])
const BAJORAN = card('m-bajoran', 'PERSON', ['BAJORAN'])
const FERENGI = card('m-ferengi', 'PERSON', ['FERENGI'])
const SF_VULCAN = card('m-sf-vulcan', 'PERSON', ['VULCAN', 'STARFLEET'])
const WILD = card('m-wild', 'PERSON', ['WILDCARD'])
const LOC = card('m-loc', 'LOCATION')

// ---------------------------------------------------------------------------
// Goal forms
// ---------------------------------------------------------------------------

describe('SAME_SHIP goals: counts and distinct cards (rules/07 §7.2)', () => {
	const three: Predicate = {
		k: 'SAME_SHIP',
		requirements: [{ count: 3, filter: { suits: ['ALLY'] } }],
	}

	it('"3 ALLY on the same SHIP" needs three ALLYs on ONE ship', () => {
		const t = new Table(board([]))
		const a = t.ship(SHIP)
		const b = t.ship(SHIP)
		t.beam(ALLY, a)
		t.beam(ALLY, a)
		t.beam(ALLY, b)
		expect(goalOf(t.s, three)).toBe(false) // 2 + 1 split over two ships
		t.beam(ALLY, a)
		expect(goalOf(t.s, three)).toBe(true)
	})

	it('one card never fills two requirements (a ROMULAN-KLINGON alone fails)', () => {
		const goal: Predicate = {
			k: 'SAME_SHIP',
			requirements: [
				{ filter: { traits: ['ROMULAN'] } },
				{ filter: { traits: ['KLINGON'] } },
			],
		}
		const t = new Table(board([]))
		const ship = t.ship(SHIP)
		t.beam(HYBRID, ship)
		expect(goalOf(t.s, goal)).toBe(false)
		t.beam(KLINGON, ship)
		expect(goalOf(t.s, goal)).toBe(true) // hybrid = ROMULAN, the other = KLINGON
		// the SHIP itself may be the KLINGON ("a SHIP that has KLINGON")
		const t2 = new Table(board([]))
		const k = t2.ship(KSHIP)
		t2.beam(ROMULAN, k)
		expect(goalOf(t2.s, goal)).toBe(true)
	})

	it('"3 different of X / Y / Z": each card stands for ONE different trait', () => {
		const goal: Predicate = {
			k: 'SAME_SHIP',
			requirements: [
				{ filter: { traits: ['HUMAN'] } },
				{
					count: 3,
					different: ['VULCAN', 'TELLARITE', 'ANDORIAN', 'AMBASSADOR'],
				},
			],
		}
		const t = new Table(board([]))
		const ship = t.ship(SHIP)
		t.beam(HUMAN, ship)
		t.beam(VULCAN, ship)
		t.beam(VULCAN, ship)
		t.beam(ANDORIAN, ship)
		expect(goalOf(t.s, goal)).toBe(false) // two VULCANs are one kind
		t.beam(VULCAN_AMB, ship)
		expect(goalOf(t.s, goal)).toBe(true) // VULCAN + ANDORIAN + (the other) AMBASSADOR
	})

	it("different SPECIES on the same SHIP honours the filter's exclusion", () => {
		const goal: Predicate = {
			k: 'SAME_SHIP',
			requirements: [
				{
					count: 3,
					different: 'SPECIES',
					filter: { not: { traits: ['STARFLEET'] } },
				},
			],
		}
		const t = new Table(board([]))
		const ship = t.ship(SHIP)
		t.beam(BAJORAN, ship)
		t.beam(FERENGI, ship)
		t.beam(SF_VULCAN, ship)
		expect(goalOf(t.s, goal)).toBe(false) // the STARFLEET Vulcan is excluded
		t.beam(VULCAN, ship)
		expect(goalOf(t.s, goal)).toBe(true)
	})
})

describe('DIFFERENT_SPECIES_IN_PLAY: exclusions and per-card ALIEN/TRANSCENDENT', () => {
	const goal = (count: number): Predicate => ({
		k: 'DIFFERENT_SPECIES_IN_PLAY',
		count,
		filter: { not: { traits: ['HUMAN', 'STARFLEET'] } },
		eachDistinct: ['ALIEN', 'TRANSCENDENT'],
	})

	it('each ALIEN and each TRANSCENDENT counts as its own species', () => {
		const t = new Table(board([]))
		t.put(ALIEN, { k: 'STAGING', seat: 0 })
		t.put(ALIEN, { k: 'STAGING', seat: 0 })
		t.put(TRANSC, { k: 'STAGING', seat: 0 })
		t.put(TRANSC, { k: 'STAGING', seat: 0 })
		expect(goalOf(t.s, goal(4))).toBe(true)
		// without the clause two ALIENs are one species
		expect(goalOf(t.s, { k: 'DIFFERENT_SPECIES_IN_PLAY', count: 3 })).toBe(
			false,
		)
	})

	it('cards with HUMAN / STARFLEET are not counted', () => {
		const t = new Table(board([]))
		t.put(HUMAN, { k: 'STAGING', seat: 0 })
		t.put(SF_VULCAN, { k: 'STAGING', seat: 0 })
		t.put(BAJORAN, { k: 'STAGING', seat: 0 })
		expect(goalOf(t.s, goal(2))).toBe(false)
		t.put(FERENGI, { k: 'STAGING', seat: 0 })
		expect(goalOf(t.s, goal(2))).toBe(true)
	})

	it('a WILDCARD is never compelled into an exclusion — it still counts', () => {
		const t = new Table(board([]))
		t.put(BAJORAN, { k: 'STAGING', seat: 0 })
		t.put(WILD, { k: 'STAGING', seat: 0 })
		expect(goalOf(t.s, goal(2))).toBe(true)
	})
})

describe('CONTROLS_LOCATION is seat-relative', () => {
	it('counts the acting seat’s own Location Area for seat 1 too', () => {
		const goal: Predicate = { k: 'CONTROLS_LOCATION', count: 2 }
		const t = new Table(board([], 'ADVANCED', 1))
		t.put(LOC, { k: 'LOCATION_AREA', seat: 1 }, 1)
		t.put(LOC, { k: 'LOCATION_AREA', seat: 0 }, 0)
		expect(goalOf(t.s, goal, 1)).toBe(false) // seat 0's Location is not seat 1's
		t.put(LOC, { k: 'LOCATION_AREA', seat: 1 }, 1)
		expect(goalOf(t.s, goal, 1)).toBe(true)
		expect(goalOf(t.s, goal, 0)).toBe(false)
	})
})

describe('witness dismissal: only the contributing beamed cards (rules/07 §7.2.1 #2)', () => {
	const m = (goal: Predicate): MissionState => ({
		index: 0,
		goal,
		reward: { k: 'NOOP' },
		vp: 1,
		completed: false,
	})

	it('four ALLYs on the ship for "3 ALLY": the player picks which three go', () => {
		const t = new Table(
			board([
				m({
					k: 'SAME_SHIP',
					requirements: [{ count: 3, filter: { suits: ['ALLY'] } }],
				}),
			]),
		)
		const allies: CardInstanceId[] = []
		const ship = t.ship(SHIP)
		for (let i = 0; i < 4; i++) {
			const a = t.beam(ALLY, ship)
			allies.push(a)
		}
		const { state, asked } = complete(t.s, 0, (c) =>
			c.k === 'CHOOSE_WITNESS' ? allies.slice(1) : undefined,
		)
		const witness = asked.find((c) => c.k === 'CHOOSE_WITNESS')
		expect(witness?.k === 'CHOOSE_WITNESS' && witness.sets).toHaveLength(4)
		expect(where(state, allies[0]!)).toBe('BEAMED') // not chosen: stays
		for (const a of allies.slice(1)) expect(where(state, a)).toBe('DISCARD')
		expect(where(state, ship)).toBe('FLEET')
	})

	it('an AND goal dismisses the contributors of every term, and nothing else', () => {
		const t = new Table(
			board([
				m({
					k: 'AND',
					terms: [
						{
							k: 'SAME_SHIP',
							requirements: [{ filter: { traits: ['KLINGON'] } }],
						},
						{
							k: 'COUNT_AT_LEAST',
							query: {
								zones: ['IN_PLAY'],
								filter: { traits: ['VULCAN'] },
							},
							value: 1,
						},
					],
				}),
			]),
		)
		const ship = t.ship(SHIP)
		const k = t.beam(KLINGON, ship)
		const v = t.beam(VULCAN, ship)
		const h = t.beam(HUMAN, ship) // on the ship, contributes nothing
		const { state, asked } = complete(t.s, 0)
		expect(asked.filter((c) => c.k === 'CHOOSE_WITNESS')).toEqual([])
		expect(where(state, k)).toBe('DISCARD')
		expect(where(state, v)).toBe('DISCARD')
		expect(where(state, h)).toBe('BEAMED')
	})

	it('a non-beamed contributor (the SHIP itself, a Staging card) is never dismissed', () => {
		const t = new Table(
			board([
				m({
					k: 'SAME_SHIP',
					requirements: [
						{ filter: { traits: ['ROMULAN'] } },
						{ filter: { traits: ['KLINGON'] } },
					],
				}),
			]),
		)
		const ship = t.ship(KSHIP)
		const r = t.beam(ROMULAN, ship)
		const k = t.beam(KLINGON, ship) // not needed: the ship is the KLINGON
		const { state } = complete(t.s, 0)
		expect(where(state, r)).toBe('DISCARD')
		expect(where(state, k)).toBe('BEAMED')
		expect(where(state, ship)).toBe('FLEET')
	})
})

describe('reward mechanics', () => {
	it('an Attack Reward opens an attack: the victim is ATTACKED afterwards', () => {
		const s0 = board([
			{
				index: 0,
				goal: { k: 'SPECIALTY_AT_LEAST', specialty: 'RESEARCH', value: 0 },
				reward: {
					k: 'FORCE',
					body: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
				},
				isAttack: true,
				vp: 1,
				completed: false,
			},
		])
		const { state, events } = complete(s0, 0)
		expect(
			events.some((e) => e.k === 'ATTACKED' && e.seat === 0 && e.victim === 1),
		).toBe(true)
		expect(Object.keys(state.pending ?? {})).toEqual([]) // record closed
		// a plain reward is no attack
		const plain = complete(
			board([{ ...s0.players[0].missions[0]!, isAttack: undefined }]),
			0,
		)
		expect(plain.events.some((e) => e.k === 'ATTACKED')).toBe(false)
	})

	it('GAIN_RESOURCE fromSupply leaves the Stardate card alone', () => {
		const run = (fromSupply: boolean): GameState => {
			const s = withStardate(
				board([
					{
						index: 0,
						goal: { k: 'SPECIALTY_AT_LEAST', specialty: 'RESEARCH', value: 0 },
						reward: {
							k: 'GAIN_RESOURCE',
							res: 'GLO',
							amount: 2,
							...(fromSupply ? { fromSupply: true } : {}),
						},
						vp: 0,
						completed: false,
					},
				]),
			)
			return complete(s, 0).state
		}
		const supply = run(true)
		expect(player(supply, 0).resources.GLO).toBe(2)
		expect(supply.stardates.gloryOnTop).toBe(5)
		const stardate = run(false)
		expect(player(stardate, 0).resources.GLO).toBe(2)
		expect(stardate.stardates.gloryOnTop).toBe(3)
	})

	it('ENLIST_DEVELOPMENT with an "or" discount pool offers the split', () => {
		const dev = card('m-dev', 'CARGO', [], {
			developmentCost: {
				k: 'SEQ',
				steps: [
					{ k: 'COST_RESOURCE', res: 'DIL', amount: 2 },
					{ k: 'COST_RESOURCE', res: 'LAT', amount: 2 },
				],
			},
		})
		const reward: Effect = {
			k: 'ENLIST_DEVELOPMENT',
			discount: [{ res: ['DIL', 'LAT'], amount: 1 }],
		}
		const t = new Table(
			board([
				{
					index: 0,
					goal: { k: 'SPECIALTY_AT_LEAST', specialty: 'RESEARCH', value: 0 },
					reward,
					vp: 0,
					completed: false,
				},
			]),
		)
		const d = t.put(dev, { k: 'DEVELOPMENT', seat: 0 })
		t.s = setResources(setResources(t.s, 0, 'DIL', 2), 0, 'LAT', 2)
		const { state, asked } = complete(t.s, 0, (c) =>
			c.k === 'CHOOSE_OPTION'
				? { key: c.options.find((o) => /LAT/.test(o.label))!.key }
				: undefined,
		)
		const opts = asked.find((c) => c.k === 'CHOOSE_OPTION')
		expect(
			opts?.k === 'CHOOSE_OPTION' && opts.options.map((o) => o.label),
		).toEqual(['Reduce the cost by 1 DIL', 'Reduce the cost by 1 LAT'])
		expect(zone(state, 'DRAW:0')[0]).toBe(d) // enlisted onto the deck top
		expect(player(state, 0).resources).toMatchObject({ DIL: 0, LAT: 1 })
	})
})

// ---------------------------------------------------------------------------
// Track multipliers
// ---------------------------------------------------------------------------

describe('track multipliers: per crew and per board side (rules/07 §7.1.4)', () => {
	function seated(deck: DeckId, side: 'BASIC' | 'ADVANCED'): GameState {
		const config: SetupConfig = {
			seed: 3,
			mode: 'TWO_PLAYER',
			players: [
				{ deck, boardSide: side },
				{ deck: deck === 'PIC' ? 'SHR' : 'PIC', boardSide: 'BASIC' },
			],
		}
		return setup(config, catalog)
	}

	it('setup copies the chosen side’s glyphs onto the player', () => {
		const adv = seated('PIC', 'ADVANCED')
		expect(player(adv, 0).tracks.INFLUENCE).toEqual([
			{ step: 3, value: 1 },
			{ step: 8, value: 2 },
			{ step: 11, value: 4 },
			{ step: 15, value: 5 }, // tops at ×5 (strategy guide; user decision)
		])
		const basic = seated('PIC', 'BASIC')
		expect(player(basic, 0).tracks.INFLUENCE.at(-1)).toEqual({
			step: 15,
			value: 7,
		})
	})

	it('Advanced: no glyph at step 0 → ×0; Basic: ×1 at step 0', () => {
		let adv = seated('SEL', 'ADVANCED')
		expect(highestMultiplierReached(adv, 0, 'RESEARCH')).toBe(0)
		adv = setSpecialty(adv, 0, 'RESEARCH', 5)
		expect(highestMultiplierReached(adv, 0, 'RESEARCH')).toBe(2)
		const basic = seated('SEL', 'BASIC')
		expect(highestMultiplierReached(basic, 0, 'RESEARCH')).toBe(1)
		expect(
			highestMultiplierReached(
				setSpecialty(basic, 0, 'RESEARCH', 5),
				0,
				'RESEARCH',
			),
		).toBe(3)
	})

	it('each crew has its own glyphs (SIS Basic Research ×5 at 11, BUR ×4 at 10)', () => {
		const sis = setSpecialty(seated('SIS', 'BASIC'), 0, 'RESEARCH', 11)
		expect(highestMultiplierReached(sis, 0, 'RESEARCH')).toBe(5)
		const bur = setSpecialty(seated('BUR', 'BASIC'), 0, 'RESEARCH', 11)
		expect(highestMultiplierReached(bur, 0, 'RESEARCH')).toBe(4)
	})

	it('final scoring: Advanced Focus below the first glyph scores 0', () => {
		const focus = card('m-focus', 'PERSON', [], { focus: 'FOCUS_MILITARY' })
		const s0 = seated('PIC', 'ADVANCED')
		const t = new Table({
			...s0,
			players: s0.players.map((pl) =>
				pl.seat === 0
					? {
							...pl,
							missions: pl.missions.map((m, i) =>
								i === 0 ? { ...m, completed: true } : m,
							),
						}
					: pl,
			) as GameState['players'],
		})
		t.put(focus, { k: 'LOG', seat: 0 })
		t.s = setSpecialty(t.s, 0, 'MILITARY', 4)
		expect(score(t.s, 0).focus.find((f) => f.specialty === 'MILITARY')).toEqual(
			{
				specialty: 'MILITARY',
				multiplier: 0,
				cards: 1,
				vp: 0,
			},
		)
		t.s = setSpecialty(t.s, 0, 'MILITARY', 5)
		expect(
			score(t.s, 0).focus.find((f) => f.specialty === 'MILITARY')?.vp,
		).toBe(2)
	})
})

// ---------------------------------------------------------------------------
// The 18 missions (real board data)
// ---------------------------------------------------------------------------

describe('board data', () => {
	it('each Basic side prints exactly mission 1 (0 VP); Advanced prints M1..M3', () => {
		for (const deck of ['PIC', 'SHR', 'KOL', 'SEL', 'SIS', 'BUR'] as const) {
			const b = catalog.boards[deck]!
			expect(b.basic.map((m) => [m.cardId, m.vp])).toEqual([
				[b.advanced[0]!.cardId, 0],
			])
			expect(b.advanced).toHaveLength(3)
		}
	})
})

describe('PIC missions', () => {
	it('1PIC/M1: 3 ALLY on a ship + two tracks at 4+', () => {
		const t = new Table(board([mission('PIC', 1)]))
		const allies: CardInstanceId[] = []
		const ship = t.ship(SHIP)
		for (let i = 0; i < 3; i++) {
			const a = t.beam(ALLY, ship)
			allies.push(a)
		}
		t.s = setSpecialty(t.s, 0, 'MILITARY', 4)
		expect(canComplete(t.s, 0, 0)).toBe(false) // only one track at 4+
		t.s = setSpecialty(t.s, 0, 'RESEARCH', 4)
		expect(canComplete(t.s, 0, 0)).toBe(true)
		const deck = card('m-deck', 'CARGO')
		for (let i = 0; i < 5; i++) t.put(deck, { k: 'DRAW', seat: 0 })
		const { state } = complete(t.s, 0)
		expect(player(state, 0).resources.DIL).toBe(4)
		expect(zone(state, 'HAND:0')).toHaveLength(4)
		for (const a of allies) expect(where(state, a)).toBe('DISCARD')
	})

	it('1PIC/M2: 3 KLINGON on a ship → Glory, INF/MIL, an action', () => {
		const t = new Table(board([mission('PIC', 2)]))
		const ship = t.ship(KSHIP)
		t.beam(KLINGON, ship)
		t.beam(KLINGON, ship)
		expect(canComplete(t.s, 0, 0)).toBe(true) // the KLINGON ship is the third
		const acts = player(t.s, 0).actions.available
		const { state } = complete(t.s, 0, (c) =>
			c.k === 'CHOOSE_OPTION'
				? { key: c.options.find((o) => /MILITARY/.test(o.label))!.key }
				: undefined,
		)
		expect(player(state, 0).resources.GLO).toBe(1)
		expect(player(state, 0).specialties.MILITARY).toBe(1)
		expect(player(state, 0).actions.available).toBe(acts + 1)
	})

	it('1PIC/M3: 6 species, ALIENs each count → take an ENCOUNTER', () => {
		const t = new Table(board([mission('PIC', 3)]))
		for (const d of [ALIEN, ALIEN, TRANSC, BAJORAN, FERENGI]) {
			t.put(d, { k: 'STAGING', seat: 0 })
		}
		t.put(HUMAN, { k: 'STAGING', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(false) // HUMAN excluded → 5
		t.put(VULCAN, { k: 'STAGING', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(true)
		const enc = card('m-enc', 'ENCOUNTER')
		const e = t.put(enc, { k: 'ENCOUNTER_DECK' }, null)
		const { state } = complete(t.s, 0)
		expect(where(state, e)).toBe('HAND')
	})
})

describe('KOL missions', () => {
	it('1KOL/M1: 6 ships/locations, one of each; dismiss a ship', () => {
		const t = new Table(board([mission('KOL', 1)]))
		const ships: CardInstanceId[] = []
		for (let i = 0; i < 6; i++) {
			const sh = t.ship(SHIP)
			ships.push(sh)
		}
		expect(canComplete(t.s, 0, 0)).toBe(false) // no controlled Location
		t.put(LOC, { k: 'LOCATION_AREA', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(true)
		const res = card('m-res', 'PERSON')
		t.put(res, { k: 'RESERVE', seat: 0 })
		t.put(res, { k: 'RESERVE', seat: 0 })
		const { state } = complete(t.s, 0)
		expect(zone(state, 'RESERVE:0')).toHaveLength(0) // two Reserves enlisted
		expect(ships.filter((sh) => where(state, sh) === 'DISCARD')).toHaveLength(1)
	})

	it('1KOL/M2: enlist 1KOL03 free', () => {
		const cloak = card('1KOL03-24', 'CARGO', ['CLOAK'], {
			developmentCost: { k: 'COST_RESOURCE', res: 'DIL', amount: 3 },
		})
		const other = card('m-otherdev', 'CARGO', [], {
			developmentCost: { k: 'COST_RESOURCE', res: 'DIL', amount: 0 },
		})
		const t = new Table(board([mission('KOL', 2)]))
		const ship = t.ship(SHIP)
		const r = t.beam(ROMULAN, ship)
		expect(canComplete(t.s, 0, 0)).toBe(false) // no KLINGON on that ship
		t.beam(KLINGON, ship)
		t.put(other, { k: 'DEVELOPMENT', seat: 0 })
		const c = t.put(cloak, { k: 'DEVELOPMENT', seat: 0 })
		const { state } = complete(t.s, 0)
		expect(player(state, 0).specialties.MILITARY).toBe(1) // 1 ROMULAN in play
		expect(zone(state, 'DRAW:0')[0]).toBe(c)
		expect(player(state, 0).resources.DIL).toBe(0) // free
		expect(where(state, r)).toBe('DISCARD')
	})

	it('1KOL/M3: species excl. KLINGON, 2 WEAPON not the captain, 1 SCIENTIST; attack', () => {
		const weapon = card('m-weapon', 'CARGO', ['WEAPON'])
		const capt = card('m-capt-weapon', 'CAPTAIN', ['KLINGON', 'WEAPON'])
		const sci = card('m-sci', 'PERSON', ['KLINGON', 'SCIENTIST'])
		const t = new Table(board([mission('KOL', 3)]))
		t.put(capt, { k: 'CAPTAIN', seat: 0 })
		t.put(weapon, { k: 'STAGING', seat: 0 })
		t.put(sci, { k: 'STAGING', seat: 0 })
		t.put(BAJORAN, { k: 'STAGING', seat: 0 })
		t.put(KLINGON, { k: 'STAGING', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(false) // 1 species (KLINGONs excluded), 1 WEAPON
		t.put(FERENGI, { k: 'STAGING', seat: 0 })
		t.put(weapon, { k: 'STAGING', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(true)
		const inc = card('m-incident', 'INCIDENT')
		for (let i = 0; i < 3; i++) t.put(inc, { k: 'INCIDENT_DECK' }, null)
		const { state, events } = complete(t.s, 0)
		expect(zone(state, 'HAND:1')).toHaveLength(2) // opponent took 2 INCIDENT
		expect(events.some((e) => e.k === 'ATTACKED' && e.victim === 1)).toBe(true)
	})
})

describe('SHR missions', () => {
	it('1SHR/M1: 3 controlled Locations + 4 WEAPON', () => {
		const weapon = card('m-weapon', 'CARGO', ['WEAPON'])
		const t = new Table(board([mission('SHR', 1)]))
		for (let i = 0; i < 3; i++) t.put(LOC, { k: 'LOCATION_AREA', seat: 0 })
		for (let i = 0; i < 3; i++) t.put(weapon, { k: 'STAGING', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(false)
		t.put(weapon, { k: 'STAGING', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(true)
		const deck = card('m-deck', 'CARGO')
		t.put(deck, { k: 'DRAW', seat: 0 })
		const acts = player(t.s, 0).actions.available
		const { state } = complete(t.s, 0)
		expect(zone(state, 'HAND:0')).toHaveLength(1)
		expect(player(state, 0).actions.available).toBe(acts + 1)
	})

	it('1SHR/M2: 1 HUMAN + 3 different of the list on one ship', () => {
		const t = new Table(board([mission('SHR', 2)]))
		const ship = t.ship(SHIP)
		t.beam(HUMAN, ship)
		t.beam(VULCAN, ship)
		t.beam(ANDORIAN, ship)
		t.beam(ANDORIAN, ship)
		expect(canComplete(t.s, 0, 0)).toBe(false)
		t.beam(TELLARITE, ship)
		expect(canComplete(t.s, 0, 0)).toBe(true)
		const { state } = complete(t.s, 0)
		expect(player(state, 0).specialties).toEqual({
			RESEARCH: 2,
			INFLUENCE: 2,
			MILITARY: 2,
		})
		// HUMAN + 3 contributors dismissed; the spare ANDORIAN stays
		expect(zone(state, `BEAMED:${ship}`)).toHaveLength(1)
	})

	it('1SHR/M3: 3 BUSINESS → 2 LAT and 1 GLO', () => {
		const biz = card('m-biz', 'PERSON', ['BUSINESS'])
		const t = new Table(board([mission('SHR', 3)]))
		for (let i = 0; i < 2; i++) t.put(biz, { k: 'STAGING', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(false)
		t.put(biz, { k: 'STAGING', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(true)
		const { state } = complete(t.s, 0)
		expect(player(state, 0).resources).toMatchObject({ LAT: 2, GLO: 1 })
	})
})

describe('SIS missions', () => {
	it('1SIS/M1: 4 ships + INF or MIL 7 → enlist, −1 DIL/LAT per STARBASE', () => {
		const starbase = card('m-starbase', 'LOCATION', ['STARBASE'])
		const dev = card('m-dev3', 'CARGO', [], {
			developmentCost: { k: 'COST_RESOURCE', res: 'DIL', amount: 3 },
		})
		const t = new Table(board([mission('SIS', 1)]))
		for (let i = 0; i < 4; i++) t.ship(SHIP)
		expect(canComplete(t.s, 0, 0)).toBe(false)
		t.s = setSpecialty(t.s, 0, 'MILITARY', 7)
		expect(canComplete(t.s, 0, 0)).toBe(true)
		t.put(starbase, { k: 'LOCATION_AREA', seat: 0 })
		t.put(starbase, { k: 'LOCATION_AREA', seat: 0 })
		const d = t.put(dev, { k: 'DEVELOPMENT', seat: 0 })
		t.s = setResources(t.s, 0, 'DIL', 1)
		const { state } = complete(t.s, 0) // 3 DIL − 2 STARBASE = 1 DIL
		expect(zone(state, 'DRAW:0')[0]).toBe(d)
		expect(player(state, 0).resources.DIL).toBe(0)
	})

	it('1SIS/M2’s Application: STARFLEET (not the captain), BAJORAN, a ship at 1SIS02', () => {
		const sis02 = card('1SIS02-25', 'LOCATION', ['BAJORAN'], {
			operations: [
				op('CONTROL', { k: 'GAIN_RESOURCE', res: 'LAT', amount: 2 }),
			],
		})
		const sf = card('m-sf', 'PERSON', ['STARFLEET'])
		const sfCapt = card('m-sf-capt', 'CAPTAIN', ['STARFLEET', 'HUMAN'])
		const t = new Table(board([mission('SIS', 2)]))
		const b = t.put(sis02, { k: 'LOCATION_AREA', seat: 0 }, 0, {
			exhausted: true,
		})
		t.put(sfCapt, { k: 'CAPTAIN', seat: 0 })
		t.put(sf, { k: 'STAGING', seat: 0 })
		t.put(BAJORAN, { k: 'STAGING', seat: 0 })
		t.put(BAJORAN, { k: 'STAGING', seat: 0 })
		t.ship(SHIP, 0, b)
		expect(canComplete(t.s, 0, 0)).toBe(false) // one STARFLEET besides the captain
		t.put(sf, { k: 'STAGING', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(true)
		const { state } = complete(t.s, 0)
		expect(player(state, 0).resources.LAT).toBe(2) // 1SIS02's control op
		expect(state.cards[b]!.exhausted).toBe(false) // refreshed
	})

	it('1SIS/M3: 3 DOMINION/CHANGELING → 3 INF, draw 2', () => {
		const dom = card('m-dominion', 'PERSON', ['DOMINION'])
		const ch = card('m-changeling', 'PERSON', ['CHANGELING'])
		const t = new Table(board([mission('SIS', 3)]))
		t.put(dom, { k: 'STAGING', seat: 0 })
		t.put(ch, { k: 'STAGING', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(false)
		t.put(dom, { k: 'STAGING', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(true)
		const deck = card('m-deck', 'CARGO')
		for (let i = 0; i < 2; i++) t.put(deck, { k: 'DRAW', seat: 0 })
		const { state } = complete(t.s, 0)
		expect(player(state, 0).specialties.INFLUENCE).toBe(3)
		expect(zone(state, 'HAND:0')).toHaveLength(2)
	})
})

describe('SEL missions', () => {
	it('1SEL/M1: INF 6 + MIL 6 → enlist, find an ATTACK', () => {
		const atk = card('m-attack', 'DIRECTIVE', ['ATTACK'])
		const dev = card('m-freedev', 'CARGO', [], {
			developmentCost: { k: 'COST_RESOURCE', res: 'DIL', amount: 0 },
		})
		const t = new Table(board([mission('SEL', 1)]))
		t.s = setSpecialty(t.s, 0, 'INFLUENCE', 6)
		expect(canComplete(t.s, 0, 0)).toBe(false)
		t.s = setSpecialty(t.s, 0, 'MILITARY', 6)
		expect(canComplete(t.s, 0, 0)).toBe(true)
		t.put(dev, { k: 'DEVELOPMENT', seat: 0 })
		const a = t.put(atk, { k: 'DISCARD', seat: 0 })
		const { state } = complete(t.s, 0)
		expect(zone(state, 'DEVELOPMENT:0')).toHaveLength(0)
		expect(where(state, a)).toBe('HAND')
	})

	it('1SEL/M2: 4 VULCAN → 3 INF, a card per SHADY', () => {
		const shady = card('m-shady', 'PERSON', ['SHADY'])
		const t = new Table(board([mission('SEL', 2)]))
		for (let i = 0; i < 3; i++) t.put(VULCAN, { k: 'STAGING', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(false)
		t.put(VULCAN, { k: 'STAGING', seat: 0 })
		t.put(shady, { k: 'STAGING', seat: 0 })
		t.put(shady, { k: 'STAGING', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(true)
		const deck = card('m-deck', 'CARGO')
		for (let i = 0; i < 3; i++) t.put(deck, { k: 'DRAW', seat: 0 })
		const { state } = complete(t.s, 0)
		expect(player(state, 0).specialties.INFLUENCE).toBe(3)
		expect(zone(state, 'HAND:0')).toHaveLength(2)
	})

	it('1SEL/M3: KLINGON on a CLOAK ship → MIL, Glory from the supply, dismissals', () => {
		const cloakShip = card('m-cloakship', 'SHIP', ['CLOAK'])
		const t = new Table(withStardate(board([mission('SEL', 3)])))
		const ship = t.ship(cloakShip)
		expect(canComplete(t.s, 0, 0)).toBe(false)
		const k1 = t.beam(KLINGON, ship)
		const k2 = t.put(KLINGON, { k: 'STAGING', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(true)
		const { state } = complete(t.s, 0)
		expect(player(state, 0).specialties.MILITARY).toBe(1) // 1 CLOAK
		expect(player(state, 0).resources.GLO).toBe(4) // 2 × 2 KLINGON in play
		expect(state.stardates.gloryOnTop).toBe(5) // not from the Stardate card
		expect(where(state, ship)).toBe('DISCARD') // the one CLOAK
		expect(where(state, k1)).toBe('DISCARD')
		expect(where(state, k2)).toBe('STAGING') // not beamed: stays
	})
})

describe('BUR missions', () => {
	it('1BUR/M1: 2 INCIDENT + SCIENTIST + KELPIEN on a ship, RES 5', () => {
		const inc = card('m-incident', 'INCIDENT')
		const sci = card('m-scientist', 'PERSON', ['SCIENTIST'])
		const kel = card('m-kelpien', 'PERSON', ['KELPIEN', 'SCIENTIST'])
		const enc = card('m-enc', 'ENCOUNTER')
		const t = new Table(board([mission('BUR', 1)]))
		const ship = t.ship(SHIP)
		t.beam(inc, ship)
		t.beam(inc, ship)
		t.beam(kel, ship)
		t.s = setSpecialty(t.s, 0, 'RESEARCH', 5)
		expect(canComplete(t.s, 0, 0)).toBe(false) // the KELPIEN can't be the SCIENTIST too
		t.beam(sci, ship)
		expect(canComplete(t.s, 0, 0)).toBe(true)
		const e = t.put(enc, { k: 'ENCOUNTER_DECK' }, null)
		const { state } = complete(t.s, 0)
		expect(zone(state, 'DRAW:0')[0]).toBe(e)
		expect(zone(state, `BEAMED:${ship}`)).toHaveLength(0) // all four dismissed
	})

	it('1BUR/M2: ANOMALY logged, 3 STARFLEET, 3 species on a ship', () => {
		const anomaly = card('m-anomaly', 'ENCOUNTER', ['ANOMALY'])
		const sf = card('m-sf', 'PERSON', ['STARFLEET'])
		const t = new Table(board([mission('BUR', 2)]))
		t.put(anomaly, { k: 'LOG', seat: 0 })
		for (let i = 0; i < 3; i++) t.put(sf, { k: 'STAGING', seat: 0 })
		const ship = t.ship(SHIP)
		t.beam(BAJORAN, ship)
		t.beam(FERENGI, ship)
		t.beam(SF_VULCAN, ship)
		expect(canComplete(t.s, 0, 0)).toBe(false)
		t.beam(ANDORIAN, ship)
		expect(canComplete(t.s, 0, 0)).toBe(true)
		const l = t.put(LOC, { k: 'LOCATION_DECK' }, null)
		const { state } = complete(t.s, 0)
		expect(where(state, l)).toBe('LOCATION_AREA')
	})

	it('1BUR/M3: free play an INCIDENT for 2/2/2', () => {
		const orion = card('m-orion', 'PERSON', ['ORION'])
		const shady = card('m-shady', 'PERSON', ['SHADY'])
		const inc = card('m-incident-play', 'INCIDENT', [], {
			operations: [op('PLAY', { k: 'NOOP' })],
		})
		const t = new Table(board([mission('BUR', 3)]))
		t.put(orion, { k: 'STAGING', seat: 0 })
		t.put(orion, { k: 'STAGING', seat: 0 })
		t.put(shady, { k: 'LOG', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(false)
		t.put(shady, { k: 'LOG', seat: 0 })
		expect(canComplete(t.s, 0, 0)).toBe(true)
		// no INCIDENT to play: nothing gained
		expect(player(complete(t.s, 0).state, 0).resources).toMatchObject({
			GLO: 0,
			DIL: 0,
			LAT: 0,
		})
		t.put(inc, { k: 'HAND', seat: 0 })
		const { state } = complete(t.s, 0)
		expect(player(state, 0).resources).toMatchObject({ GLO: 2, DIL: 2, LAT: 2 })
	})
})

// ---------------------------------------------------------------------------
// Gained actions and the Clean-up cap (rules/03 §3.5.1, §3.6.7; STCC FAQ
// `action-cap` — the action pool is trimmed back to 3 at Clean-up —
// attached to 1PIC/M2, 1SHR/M1 and every other "gain an action" card).
// ---------------------------------------------------------------------------

describe('gained actions: usable this turn, capped back to 3 at Clean-up REFRESH', () => {
	/** Run `intent` through the intent layer, answering every choice. */
	function drive(
		s0: GameState,
		intent: Parameters<typeof reduce>[1],
		answer: Answer = firstLegal,
	): { state: GameState; asked: PendingChoice[] } {
		const asked: PendingChoice[] = []
		let s = reduce(s0, intent).state
		for (let guard = 0; s.pendingChoice !== null; guard++) {
			if (guard > 80) throw new Error('test: too many choices')
			const c = s.pendingChoice
			asked.push(c)
			s = reduce(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: c.id,
				selection: answer(c) ?? firstLegal(c),
			}).state
		}
		return { state: s, asked }
	}
	const withActions = (s: GameState, available: number): GameState => ({
		...s,
		players: s.players.map((pl) =>
			pl.seat === 0
				? { ...pl, actions: { available, spent: 3 - available } }
				: pl,
		) as GameState['players'],
	})
	const realDef = (cardId: string): string => {
		const def = catalog.defs.find((d) => d.cardId === cardId)!
		register([def])
		return def.id
	}
	/** 1SHR/M1 with its goal met (3 controlled Locations + 4 WEAPON). */
	function shrM1(available: number): Table {
		const weapon = card('m-weapon', 'CARGO', ['WEAPON'])
		const t = new Table(
			withStardate(withActions(board([mission('SHR', 1)]), available)),
		)
		for (let i = 0; i < 3; i++) t.put(LOC, { k: 'LOCATION_AREA', seat: 0 })
		for (let i = 0; i < 4; i++) t.put(weapon, { k: 'STAGING', seat: 0 })
		t.put(card('m-deck', 'CARGO'), { k: 'DRAW', seat: 0 })
		return t
	}
	const ACT = card('m-act-play', 'PERSON', [], {
		operations: [op('PLAY', { k: 'NOOP' }, { costsAction: true })],
	})

	it('1SHR/M1 with every action spent: the gained action pays for an [action] play the same turn', () => {
		const t = shrM1(0)
		const p = t.put(ACT, { k: 'HAND', seat: 0 })
		expect(() =>
			reduce(t.s, { t: 'PLAY_CARD', iid: p, operationIndex: 0 }),
		).toThrow()
		const { state } = complete(t.s, 0)
		expect(player(state, 0).actions.available).toBe(1)
		const played = drive(state, {
			t: 'PLAY_CARD',
			iid: p,
			operationIndex: 0,
		}).state
		expect(player(played, 0).actions.available).toBe(0)
		expect(where(played, p)).toBe('STAGING')
	})

	it('1PIC/M2 on top of 3 unspent: 4 available during the turn, exactly 3 after Clean-up', () => {
		const t = new Table(
			withStardate(withActions(board([mission('PIC', 2)]), 3)),
		)
		const ship = t.ship(KSHIP)
		t.beam(KLINGON, ship)
		t.beam(KLINGON, ship)
		const { state } = complete(t.s, 0)
		expect(player(state, 0).actions.available).toBe(4)
		const out = drive(state, { t: 'END_TURN' }).state
		expect(out.activeSeat).toBe(1)
		expect(player(out, 0).actions.available).toBe(3) // the excess went back
	})

	it('1KOL22 counts the gained, unspent action before REFRESH caps the budget', () => {
		const kol22 = realDef('1KOL22/24')
		const t = shrM1(3)
		t.put(kol22, { k: 'STAGING', seat: 0 }) // Clean-up includes the Staging Area
		const { state } = complete(t.s, 0)
		expect(player(state, 0).actions.available).toBe(4)
		const glo = player(state, 0).resources.GLO
		const { state: out, asked } = drive(state, { t: 'END_TURN' })
		// one "you may gain 1 {GLO}" per unspent action — 4, not 3
		expect(asked.filter((c) => c.k === 'CONFIRM')).toHaveLength(4)
		expect(player(out, 0).resources.GLO).toBe(glo + 4)
		expect(player(out, 0).actions.available).toBe(3)
	})
})
