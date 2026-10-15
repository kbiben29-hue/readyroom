// Final scoring (todo/10, rules/07 §7.4, rules/12 §12.27–§12.29). Pins the
// component math: Glory, neutral tokens, ENDGAME ops (in play only), printed
// VP (incl. asterisk VP out of play), Focus × multiplier (skipped when no
// mission is completed), and completed-mission VP (Advanced side only). Also
// pins the rulebook p.25 worked example (29 VP) against a transcribed fixture.

import { describe, expect, it } from 'vitest'
import {
	fresh,
	register,
	makeDef,
	place,
	ID,
	setResources,
	setSpecialty,
	setTracks,
} from './resolver/testUtils'
import {
	score,
	finalizeGame,
	cadetBenchmark,
	highestMultiplierReached,
	countNeutralTokens,
} from './scoring'
import { assertSerialisable } from './invariants'
import type { GameState, MissionState } from './state'
import type { Effect } from './resolver/nodes'
import type { CardDef } from '../data/schema'
import type { FocusIcon, SkillIcon, Suit, TraitId } from '../data/ids'

interface DefSpec {
	id: string
	suit: Suit
	operations: CardDef['operations']
	traits?: TraitId[] | undefined
	vp?: number | undefined
	focus?: FocusIcon | null | undefined
	vpAsterisk?: boolean | undefined
	skills?: SkillIcon[] | undefined
}

function def(spec: DefSpec): CardDef {
	const base = makeDef({
		id: spec.id,
		suit: spec.suit,
		operations: spec.operations,
		traits: spec.traits,
		vp: spec.vp,
	})
	return {
		...base,
		focus: spec.focus ?? null,
		vpAsterisk: spec.vpAsterisk ?? false,
		skills: spec.skills ?? [],
	}
}

const sp: { score: Effect; countTrait: (trait: TraitId) => Effect } = {
	score: {
		k: 'SCORE_VP',
		amount: {
			k: 'COUNT',
			query: {
				zones: ['ALL_OWNED'],
				seat: 'SELF',
				filter: { suits: ['ALLY'] },
			},
		},
	},
	countTrait: (trait) => ({
		k: 'SCORE_VP',
		amount: {
			k: 'COUNT',
			query: {
				zones: ['ALL_OWNED'],
				seat: 'SELF',
				filter: { traits: [trait] },
			},
		},
	}),
}

function mkMission(
	index: 0 | 1 | 2,
	vp: number,
	goal: MissionState['goal'],
	completed = false,
): MissionState {
	return {
		index,
		goal,
		reward: { k: 'NOOP' },
		vp,
		completed,
	}
}

const SPECIALTY_GOAL = {
	k: 'SPECIALTY_AT_LEAST',
	specialty: 'RESEARCH',
	value: 3,
} as const

function withBoard(
	s: GameState,
	seat: 0 | 1,
	side: 'BASIC' | 'ADVANCED',
	missions: MissionState[],
): GameState {
	const players = s.players.map((pl) =>
		pl.seat === seat ? { ...pl, boardSide: side, missions } : pl,
	) as GameState['players']
	return { ...s, players }
}

describe('score — p.25 worked example (rules/07 §7.4.3)', () => {
	it('reproduces 29 VP: ENDGAME 4 + printed 9 + Focus 4×4', () => {
		register([
			// PIC: ENDGAME = 1 VP per ALLY owned; the printed 9 VP comes from three of
			// the four ALLYs; four cards carry a blue (Research) Focus icon.
			def({
				id: 'pic',
				suit: 'CAPTAIN',
				focus: 'FOCUS_RESEARCH',
				vp: 0,
				operations: [
					{
						type: 'ENDGAME',
						costsAction: false,
						isAttack: false,
						effect: sp.score,
						text: '1 VP per ALLY you own',
					},
				],
			}),
			def({
				id: 'ally1',
				suit: 'ALLY',
				focus: 'FOCUS_RESEARCH',
				vp: 3,
				operations: [],
			}),
			def({
				id: 'ally2',
				suit: 'ALLY',
				focus: 'FOCUS_RESEARCH',
				vp: 3,
				operations: [],
			}),
			def({
				id: 'ally3',
				suit: 'ALLY',
				focus: 'FOCUS_RESEARCH',
				vp: 3,
				operations: [],
			}),
			def({ id: 'ally4', suit: 'ALLY', focus: null, vp: 0, operations: [] }),
		])
		let s = setTracks(fresh(), 0)
		s = place(s, 'pic', ID('p'), { k: 'CAPTAIN', seat: 0 }, 0)
		s = place(s, 'ally1', ID('a1'), { k: 'LOG', seat: 0 }, 0)
		s = place(s, 'ally2', ID('a2'), { k: 'BEAMED', host: 'p' }, 0)
		s = place(s, 'ally3', ID('a3'), { k: 'DISCARD', seat: 0 }, 0)
		s = place(s, 'ally4', ID('a4'), { k: 'HAND', seat: 0 }, 0)
		s = setSpecialty(s, 0, 'RESEARCH', 12) // past the ×4 step
		s = withBoard(s, 0, 'ADVANCED', [mkMission(0, 0, SPECIALTY_GOAL, true)])

		const b = score(s, 0)
		expect(b.endgame).toEqual([
			{ card: ID('p'), label: '1 VP per ALLY you own', vp: 4 },
		])
		expect(b.printedVp.reduce((n, e) => n + e.vp, 0)).toBe(9) // ally1+ally2+ally3
		expect(b.focus).toEqual([
			{ specialty: 'RESEARCH', multiplier: 4, cards: 4, vp: 16 },
		])
		expect(b.missionsCompleted).toBe(1)
		expect(b.focusSuppressed).toBe(false)
		expect(b.glory).toBe(0)
		expect(b.neutralTokens.vp).toBe(0)
		expect(b.total).toBe(29)
		expect(highestMultiplierReached(s, 0, 'RESEARCH')).toBe(4)
	})

	it('multiplier uses the VALUE of the highest reached step, not the index', () => {
		register([
			def({
				id: 'fx1',
				suit: 'PERSON',
				focus: 'FOCUS_INFLUENCE',
				operations: [],
			}),
			def({
				id: 'fx2',
				suit: 'PERSON',
				focus: 'FOCUS_INFLUENCE',
				operations: [],
			}),
		])
		let s = setTracks(fresh(), 0)
		s = place(s, 'fx1', ID('x1'), { k: 'DISCARD', seat: 0 }, 0)
		s = place(s, 'fx2', ID('x2'), { k: 'DISCARD', seat: 0 }, 0)
		s = setSpecialty(s, 0, 'INFLUENCE', 8) // past ×2@4 and ×3@8 → 3
		expect(highestMultiplierReached(s, 0, 'INFLUENCE')).toBe(3)
		s = setSpecialty(s, 0, 'INFLUENCE', 9) // 9 is not a multiplier step; still 3
		expect(highestMultiplierReached(s, 0, 'INFLUENCE')).toBe(3)
		s = withBoard(s, 0, 'ADVANCED', [mkMission(0, 0, SPECIALTY_GOAL, true)])
		const b = score(s, 0)
		expect(b.focus).toEqual([
			{ specialty: 'INFLUENCE', multiplier: 3, cards: 2, vp: 6 },
		])
	})
})

describe('score — component edge cases (rules/12)', () => {
	it('a logged card with an ENDGAME op contributes printed VP but 0 ENDGAME (12.28)', () => {
		register([
			def({
				id: 'logged',
				suit: 'DIRECTIVE',
				vp: 5,
				operations: [
					{
						type: 'ENDGAME',
						costsAction: false,
						isAttack: false,
						effect: { k: 'SCORE_VP', amount: 100 },
						text: 'ppp',
					},
				],
			}),
			def({
				id: 'oplive',
				suit: 'CAPTAIN',
				vp: 1,
				operations: [
					{
						type: 'ENDGAME',
						costsAction: false,
						isAttack: false,
						effect: { k: 'SCORE_VP', amount: 7 },
						text: 'live endgame',
					},
				],
			}),
		])
		let s = setTracks(fresh(), 0)
		s = place(s, 'logged', ID('lg'), { k: 'LOG', seat: 0 }, 0)
		s = place(s, 'oplive', ID('op'), { k: 'CAPTAIN', seat: 0 }, 0)
		const b = score(s, 0)
		expect(b.printedVp.find((e) => e.card === ID('lg'))?.vp).toBe(5)
		expect(b.endgame.find((e) => e.card === ID('lg'))).toBeUndefined() // not evaluated
		expect(b.endgame).toEqual([
			{ card: ID('op'), label: 'live endgame', vp: 7 },
		])
	})
})

describe('score — Focus suppression (rules/12 §12.27, §7.2.2)', () => {
	it('missionsCompleted === 0 → whole Focus block is 0 and focusSuppressed is true', () => {
		register([
			def({
				id: 'fc1',
				suit: 'PERSON',
				focus: 'FOCUS_RESEARCH',
				operations: [],
			}),
		])
		let s = setTracks(fresh(), 0)
		s = place(s, 'fc1', ID('f1'), { k: 'LOG', seat: 0 }, 0)
		s = setSpecialty(s, 0, 'RESEARCH', 12)
		s = withBoard(s, 0, 'ADVANCED', [mkMission(0, 0, SPECIALTY_GOAL, false)]) // none completed
		const b = score(s, 0)
		expect(b.missionsCompleted).toBe(0)
		expect(b.focusSuppressed).toBe(true)
		expect(b.focus).toEqual([])
		expect(b.total).toBe(0)
	})

	it('completing at least one mission lifts the suppression', () => {
		register([
			def({
				id: 'fc1',
				suit: 'PERSON',
				focus: 'FOCUS_RESEARCH',
				operations: [],
			}),
		])
		let s = setTracks(fresh(), 0)
		s = place(s, 'fc1', ID('f1'), { k: 'LOG', seat: 0 }, 0)
		s = setSpecialty(s, 0, 'RESEARCH', 4) // ×2
		s = withBoard(s, 0, 'ADVANCED', [mkMission(0, 0, SPECIALTY_GOAL, true)])
		const b = score(s, 0)
		expect(b.focusSuppressed).toBe(false)
		expect(b.focus).toEqual([
			{ specialty: 'RESEARCH', multiplier: 2, cards: 1, vp: 2 },
		])
	})

	it('a WILDCARD satisfies no scoring predicate (12.12) — but does satisfy a goal', () => {
		register([
			def({
				id: 'end',
				suit: 'CAPTAIN',
				vp: 0,
				operations: [
					{
						type: 'ENDGAME',
						costsAction: false,
						isAttack: false,
						effect: sp.countTrait('HUMAN'),
						text: '1 VP per HUMAN',
					},
				],
			}),
			def({ id: 'hum1', suit: 'PERSON', traits: ['HUMAN'], operations: [] }),
			def({ id: 'hum2', suit: 'PERSON', traits: ['HUMAN'], operations: [] }),
			def({ id: 'wild', suit: 'PERSON', traits: ['WILDCARD'], operations: [] }),
		])
		let s = setTracks(fresh(), 0)
		s = place(s, 'end', ID('end'), { k: 'CAPTAIN', seat: 0 }, 0)
		s = place(s, 'hum1', ID('h1'), { k: 'LOG', seat: 0 }, 0)
		s = place(s, 'hum2', ID('h2'), { k: 'DISCARD', seat: 0 }, 0)
		s = place(s, 'wild', ID('w'), { k: 'HAND', seat: 0 }, 0)
		const b = score(s, 0)
		expect(b.endgame).toEqual([
			{ card: ID('end'), label: '1 VP per HUMAN', vp: 2 },
		]) // wildcard not counted
	})
})

describe('score — tokens on neutral vs controlled Locations (rules/07 §7.4.1 #2)', () => {
	it('neutral Locations score 1 VP per away team + ship token; controlled score 0', () => {
		register([
			def({
				id: 'nloc',
				suit: 'LOCATION',
				traits: ['STARBASE'],
				operations: [],
			}),
			def({ id: 'ship', suit: 'SHIP', operations: [] }),
		])
		let s = setTracks(fresh(), 0)
		s = place(s, 'nloc', ID('nl'), { k: 'NEUTRAL_ZONE', slot: 0 }, null)
		s = place(s, 'nloc', ID('nl2'), { k: 'NEUTRAL_ZONE', slot: 1 }, null)
		s = place(s, 'ship', ID('s0'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('nl'),
		})
		s = place(s, 'ship', ID('s1'), { k: 'FLEET', seat: 1 }, 1, {
			shipTokenAt: ID('nl'),
		})
		// seat 0: 2 away teams + 1 ship token at neutral nl; 1 away team at neutral nl2
		const at: Record<string, [number, number]> = {
			[ID('nl')]: [2, 1],
			[ID('nl2')]: [1, 0],
		}
		s = { ...s, awayTeamsAt: at }
		expect(countNeutralTokens(s, 0)).toBe(4) // 2 AT + 1 ship + 1 AT@nl2
		expect(countNeutralTokens(s, 1)).toBe(2) // 1 AT + their ship at nl

		// the same tokens on a *controlled* Location score nothing
		const cloc = place(s, 'nloc', ID('cl'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		const controlledAt: Record<string, [number, number]> = {
			...cloc.awayTeamsAt,
			[ID('cl')]: [3, 0],
		}
		const withControlled = { ...cloc, awayTeamsAt: controlledAt }
		expect(countNeutralTokens(withControlled, 0)).toBe(4) // controlled tokens ignored
		expect(countNeutralTokens(withControlled, 1)).toBe(2)
		expect(score(withControlled, 0).neutralTokens).toEqual({ count: 4, vp: 4 })
	})
})

describe('score — mission VP by board side (rules/07 §7.4.1 #6)', () => {
	const missionVps = [
		mkMission(0, 5, SPECIALTY_GOAL, true),
		mkMission(1, 7, SPECIALTY_GOAL, true),
	]

	it('Basic side adds no mission VP', () => {
		const s = withBoard(fresh(), 0, 'BASIC', missionVps)
		const b = score(s, 0)
		expect(b.missionsCompleted).toBe(2)
		expect(b.missions).toEqual([])
		expect(b.total).toBe(0)
	})

	it('Advanced side adds the printed VP per completed mission', () => {
		const s = withBoard(fresh(), 0, 'ADVANCED', missionVps)
		const b = score(s, 0)
		expect(b.missions).toEqual([
			{ index: 0, vp: 5 },
			{ index: 1, vp: 7 },
		])
		expect(b.total).toBe(12)
	})
})

describe('score — asterisk VP (rules/12 §12.28)', () => {
	it('a vpAsterisk card scores via its SPECIAL operation even out of play', () => {
		register([
			def({
				id: 'ast',
				suit: 'ALLY',
				vpAsterisk: true,
				vp: 99,
				operations: [
					{
						type: 'SPECIAL',
						costsAction: false,
						isAttack: false,
						effect: sp.countTrait('HUMAN'),
						text: 'SPECIAL: 1 VP per HUMAN you own',
					},
				],
			}),
			def({ id: 'hum', suit: 'PERSON', traits: ['HUMAN'], operations: [] }),
		])
		let s = setTracks(fresh(), 0)
		s = place(s, 'hum', ID('h1'), { k: 'LOG', seat: 0 }, 0)
		s = place(s, 'hum', ID('h2'), { k: 'DISCARD', seat: 0 }, 0)
		s = place(s, 'ast', ID('a'), { k: 'LOG', seat: 0 }, 0) // out of play — still scores
		const b = score(s, 0)
		expect(b.printedVp.find((e) => e.card === ID('a'))?.vp).toBe(2) // SPECIAL value, not 99
		expect(b.endgame).toEqual([])
	})
})

describe('score — Reserve / Development are removed first (rules/12 §12.29)', () => {
	it('Reserve and Development cards contribute no printed VP and no Focus icons', () => {
		register([
			def({
				id: 'rv',
				suit: 'PERSON',
				vp: 9,
				focus: 'FOCUS_MILITARY',
				operations: [],
			}),
			def({
				id: 'dv',
				suit: 'PERSON',
				vp: 8,
				focus: 'FOCUS_MILITARY',
				operations: [],
			}),
		])
		let s = setTracks(fresh(), 0)
		s = place(s, 'rv', ID('r1'), { k: 'RESERVE', seat: 0 }, 0)
		s = place(s, 'dv', ID('d1'), { k: 'DEVELOPMENT', seat: 0 }, 0)
		s = setSpecialty(s, 0, 'MILITARY', 12)
		s = withBoard(s, 0, 'ADVANCED', [mkMission(0, 0, SPECIALTY_GOAL, true)])
		const b = score(s, 0)
		expect(b.printedVp).toEqual([])
		expect(b.focus).toEqual([])
		expect(b.total).toBe(0)
	})
})

/** Narrow a finalised state to its COMPLETE record (throws in tests only). */
function completeOf(s: GameState): {
	scoreboard: NonNullable<
		Extract<GameState['result'], { kind: 'COMPLETE' }>
	>['scoreboard']
} {
	if (s.result === null || s.result.kind !== 'COMPLETE')
		throw new Error('expected COMPLETE result')
	return { scoreboard: s.result.scoreboard }
}

describe('finalizeGame (todo/10 result record)', () => {
	function rawState(): GameState {
		return fresh()
	}

	function incidentState(): GameState {
		register([
			def({ id: 'inc', suit: 'INCIDENT', operations: [] }),
			def({ id: 'c', suit: 'PERSON', operations: [] }),
		])
		let s = rawState()
		s = place(s, 'inc', ID('i1'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'inc', ID('i2'), { k: 'DISCARD', seat: 0 }, 0)
		s = place(s, 'inc', ID('i3'), { k: 'DRAW', seat: 0 }, 0)
		s = place(s, 'inc', ID('i4'), { k: 'LOG', seat: 0 }, 0)
		s = place(s, 'inc', ID('i5'), { k: 'HAND', seat: 1 }, 1)
		s = place(s, 'inc', ID('i6'), { k: 'LOG', seat: 1 }, 1)
		s = place(s, 'inc', ID('i7'), { k: 'LOG', seat: 1 }, 1)
		s = place(s, 'inc', ID('i8'), { k: 'RESERVE', seat: 1 }, 1) // Reserve: does not count
		return s
	}

	it('Burn: player A (4 incidents) vs B (3) → B wins; Reserve excluded', () => {
		const s: GameState = { ...incidentState(), result: { kind: 'BURN' } }
		const out = finalizeGame(s)
		assertSerialisable(out)
		expect(out.result).toMatchObject({ kind: 'COMPLETE' })
		const { scoreboard } = completeOf(out)
		expect(scoreboard.incidentCounts).toEqual([4, 3])
		expect(scoreboard.winners).toEqual([1])
		expect(scoreboard.cadetLoss).toBe(false)
	})

	it('Burn tie → falls through to final scoring', () => {
		let s = incidentState()
		// tie 4–4: give seat 1 a fourth counting incident (its Reserve card stays out)
		s = place(s, 'inc', ID('i9'), { k: 'DISCARD', seat: 1 }, 1)
		s = setResources(s, 0, 'GLO', 3)
		const burned: GameState = { ...s, result: { kind: 'BURN' } }
		const out = finalizeGame(burned)
		const { scoreboard } = completeOf(out)
		expect(scoreboard.incidentCounts).toEqual([4, 4])
		// scoring decides: seat 0 has 3 Glory → 3 > 0
		expect(scoreboard.winners).toEqual([0])
	})

	it('finalizeGame is idempotent and stores scoreVp totals', () => {
		let s = incidentState()
		s = setResources(s, 0, 'GLO', 5)
		const burned: GameState = { ...s, result: { kind: 'BURN' } }
		const once = finalizeGame(burned)
		const twice = finalizeGame(once)
		expect(twice).toBe(once)
		expect(once.scoreVp).toEqual({ 0: 5, 1: 0 })
	})

	it('Resolution end → FINAL_SCORING finalises per-seat totals exactly', () => {
		register([
			def({ id: 'glo9', suit: 'PERSON', vp: 9, operations: [] }),
			def({ id: 'glo4', suit: 'PERSON', vp: 4, operations: [] }),
			def({ id: 'glo6', suit: 'PERSON', vp: 6, operations: [] }),
		])
		let s = setTracks(fresh(), 0)
		s = place(s, 'glo9', ID('g9'), { k: 'LOG', seat: 0 }, 0)
		s = place(s, 'glo4', ID('g4'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'glo6', ID('g6'), { k: 'DISCARD', seat: 1 }, 1)
		s = setResources(s, 0, 'GLO', 2)
		const triggered: GameState = { ...s, result: { kind: 'FINAL_SCORING' } }
		const out = finalizeGame(triggered)
		const { scoreboard } = completeOf(out)
		const [b0, b1] = scoreboard.breakdown
		expect(b0.total).toBe(9 + 4 + 2) // printed VP 9+4 + Glory 2
		expect(b1.total).toBe(6)
		expect(scoreboard.winners).toEqual([0])
		expect(out.scoreVp).toEqual({ 0: 15, 1: 6 })
	})
})

describe('cadetBenchmark (rules/10 §10.4)', () => {
	it('maps the ≥70 / ≥100 / >120 bands', () => {
		expect(cadetBenchmark(0)).toBeNull()
		expect(cadetBenchmark(69)).toBeNull()
		expect(cadetBenchmark(70)).toBe('UNDERSTANDING')
		expect(cadetBenchmark(99)).toBe('UNDERSTANDING')
		expect(cadetBenchmark(100)).toBe('PROFICIENT')
		expect(cadetBenchmark(120)).toBe('PROFICIENT')
		expect(cadetBenchmark(121)).toBe('OUTSTANDING')
	})
})
