// Mission completion (todo/10, rules/07 §7.2, §7.4.1 #6). The completion gate
// is the mission's GOAL — a Specialty threshold, a Focus-icon count, or a
// Skill-icon sum — evaluated by the legality queries (rules/07 §7.2).
// COMPLETE_MISSION (via the intent layer) marks it done, resolves the REWARD,
// and the mission's printed VP scores at final scoring on the Advanced side.

import { describe, expect, it } from 'vitest'
import {
	fresh,
	register,
	makeDef,
	place,
	ID,
	setSpecialty,
} from './resolver/testUtils'
import { completableMissions, canComplete } from './queries/legality'
import { reduce, legalIntents } from './intents'
import { finalizeGame, score } from './scoring'
import type { GameState, MissionState, Phase } from './state'
import type { CardDef } from '../data/schema'
import type { TraitId } from '../data/ids'

function def(spec: {
	id: string
	suit: CardDef['suit']
	operations?: CardDef['operations']
	traits?: TraitId[]
	focus?: CardDef['focus']
	vp?: number
}): CardDef {
	const base = makeDef({
		id: spec.id,
		suit: spec.suit,
		operations: spec.operations ?? [],
		traits: spec.traits,
		vp: spec.vp,
	})
	return { ...base, focus: spec.focus ?? null }
}

function mkMission(
	index: 0 | 1 | 2,
	vp: number,
	goal: MissionState['goal'],
	reward: MissionState['reward'] = { k: 'NOOP' },
): MissionState {
	return { index, goal, reward, vp, completed: false }
}

/** A state parked in ACTION for seat 0 with the given missions/board side. */
function actionState(
	missions: MissionState[],
	side: 'BASIC' | 'ADVANCED' = 'ADVANCED',
): GameState {
	const s = fresh()
	const players = s.players.map((pl) =>
		pl.seat === 0 ? { ...pl, missions, boardSide: side } : pl,
	) as GameState['players']
	return { ...s, players, activeSeat: 0, phase: { k: 'ACTION' } as Phase }
}

register([
	def({
		id: 'focus1',
		suit: 'PERSON',
		focus: 'FOCUS_RESEARCH',
		operations: [],
	}),
	def({ id: 'skill1', suit: 'DIRECTIVE', operations: [] }),
])

/** Two RESEARCH-focused PERSONS in play (for focus-count goals). */
function withFocusCards(s: GameState, count: number): GameState {
	let out = s
	const existing = Object.keys(out.cards).filter((iid) =>
		iid.startsWith('fc'),
	).length
	for (let i = existing; i < existing + count; i++)
		out = place(out, 'focus1', ID(`fc${i}`), { k: 'DUTY_OFFICER', seat: 0 }, 0)
	return out
}

/** One card carrying `n` RESEARCH skill icons in play. */
function withSkillCard(s: GameState, n: number): GameState {
	const card = def({ id: `sk${n}`, suit: 'DIRECTIVE' })
	card.skills = Array.from({ length: n }, () => 'SKILL_RESEARCH')
	register([card])
	return place(s, `sk${n}`, ID(`sk${n}`), { k: 'FLEET', seat: 0 }, 0)
}

describe('Mission goals — specialty threshold (rules/07 §7.2)', () => {
	const goal: MissionState['goal'] = {
		k: 'SPECIALTY_AT_LEAST',
		specialty: 'RESEARCH',
		value: 3,
	}

	it('completable only while RESEARCH ≥ 3', () => {
		const missions = [mkMission(0, 5, goal)]
		let s = actionState(missions)
		s = setSpecialty(s, 0, 'RESEARCH', 2)
		expect(canComplete(s, 0, 0)).toBe(false)
		expect(completableMissions(s, 0)).toEqual([])
		s = setSpecialty(s, 0, 'RESEARCH', 3)
		expect(canComplete(s, 0, 0)).toBe(true)
		expect(completableMissions(s, 0)).toEqual([0])
	})

	it('COMPLETE_MISSION marks it done, resolves the REWARD, and legalIntents exposes it', () => {
		const reward: MissionState['reward'] = {
			k: 'GAIN_RESOURCE',
			res: 'DIL',
			amount: 1,
		}
		const missions = [mkMission(0, 5, goal, reward)]
		let s = actionState(missions)
		s = setSpecialty(s, 0, 'RESEARCH', 3)
		expect(
			legalIntents(s).some((i) => i.t === 'COMPLETE_MISSION' && i.index === 0),
		).toBe(true)

		const { state, events } = reduce(s, { t: 'COMPLETE_MISSION', index: 0 })
		expect(state.players[0].missions[0]!.completed).toBe(true)
		expect(state.players[0].resources.DIL).toBe(1) // REWARD resolved
		expect(
			events.some(
				(e) => e.k === 'MISSION_COMPLETED' && e.seat === 0 && e.index === 0,
			),
		).toBe(true)
		expect(completableMissions(state, 0)).toEqual([]) // already completed
	})

	it('an unmet goal cannot be completed (intent rejected)', () => {
		const s = actionState([mkMission(0, 5, goal)])
		expect(() => reduce(s, { t: 'COMPLETE_MISSION', index: 0 })).toThrow(
			/goal is not met/,
		)
	})

	it('completing a mission moves its VP into final scoring (Advanced side)', () => {
		let s = setSpecialty(actionState([mkMission(0, 5, goal)]), 0, 'RESEARCH', 3)
		s = reduce(s, { t: 'COMPLETE_MISSION', index: 0 }).state
		const resolved: GameState = { ...s, result: { kind: 'FINAL_SCORING' } }
		const out = finalizeGame(resolved)
		expect(out.scoreVp).toEqual({ 0: 5, 1: 0 })
		if (out.result === null || out.result.kind !== 'COMPLETE')
			throw new Error('expected COMPLETE')
		expect(out.result.scoreboard.breakdown[0].missions).toEqual([
			{ index: 0, vp: 5 },
		])
	})
})

describe('Mission goals — focus-icon count (rules/07 §7.2, countIcons FOCUS)', () => {
	const goal: MissionState['goal'] = {
		k: 'COUNT_AT_LEAST',
		query: { zones: ['IN_PLAY'], seat: 'SELF', countIcons: 'FOCUS' },
		value: 2,
	}

	it('requires 2 in-play Focus icons', () => {
		let s = withFocusCards(actionState([mkMission(0, 4, goal)]), 1)
		expect(canComplete(s, 0, 0)).toBe(false)
		s = withFocusCards(s, 1) // now 2
		expect(canComplete(s, 0, 0)).toBe(true)
		expect(completableMissions(s, 0)).toEqual([0])
	})
})

describe('Mission goals — skill-icon sum (rules/07 §7.2, countIcons SKILL)', () => {
	const goal: MissionState['goal'] = {
		k: 'COUNT_AT_LEAST',
		query: { zones: ['IN_PLAY'], seat: 'SELF', countIcons: 'SKILL' },
		value: 3,
	}

	it('requires 3 Skill icons in play', () => {
		let s = withSkillCard(actionState([mkMission(0, 6, goal)]), 2)
		expect(canComplete(s, 0, 0)).toBe(false)
		s = withSkillCard(s, 1) // card with 1 more → 3 total
		expect(canComplete(s, 0, 0)).toBe(true)
	})
})

describe('Mission VP at final scoring (rules/07 §7.4.1 #6)', () => {
	it('Basic side: completed missions award no VP; Advanced side: printed VP', () => {
		const missions = [
			mkMission(0, 8, {
				k: 'SPECIALTY_AT_LEAST',
				specialty: 'MILITARY',
				value: 1,
			}),
		]
		let s = actionState(missions, 'BASIC')
		s = setSpecialty(s, 0, 'MILITARY', 1)
		s = reduce(s, { t: 'COMPLETE_MISSION', index: 0 }).state
		const basic = score(s, 0)
		expect(basic.missionsCompleted).toBe(1)
		expect(basic.missions).toEqual([])
		expect(basic.total).toBe(0)
	})
})
