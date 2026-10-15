// Icon counting (todo/05 §5): countSkillIcons respects the zone table (Staging
// counts, BEAMED does not — rules/12 §12.3 vs §12.5), SKILL_ANY assignable per
// use, SKILL_VARIABLE conditional, countFocusIcons over ALL owned cards
// (rules/07 §7.4.1), and exhibitsSpecialty is Skill OR Focus, never a
// restriction only (rules/07 §7.1.3).

import { describe, expect, it } from 'vitest'
import { fresh, register, makeDef, place, ID } from '../resolver/testUtils'
import { countSkillIcons, countFocusIcons, exhibitsSpecialty } from './counting'
import { setSpecialty } from '../resolver/testUtils'
import type { CardDef } from '../../data/schema'
import type { GameState } from '../state'
import { assertSerialisable } from '../invariants'

const plus = (def: CardDef, extra: Partial<CardDef>): CardDef => ({
	...def,
	...extra,
})

function iconBoard(): GameState {
	register([
		plus(makeDef({ id: 'res', suit: 'PERSON', operations: [] }), {
			skills: ['SKILL_RESEARCH'],
		}),
		plus(makeDef({ id: 'any', suit: 'PERSON', operations: [] }), {
			skills: ['SKILL_ANY'],
		}),
		plus(makeDef({ id: 'mil', suit: 'PERSON', operations: [] }), {
			skills: ['SKILL_MILITARY'],
		}),
		plus(makeDef({ id: 'mil2', suit: 'PERSON', operations: [] }), {
			skills: ['SKILL_MILITARY'],
		}),
		plus(makeDef({ id: 'var', suit: 'PERSON', operations: [] }), {
			skills: ['SKILL_VARIABLE'],
			variableSkill: {
				condition: { k: 'SPECIALTY_AT_LEAST', specialty: 'RESEARCH', value: 2 },
				skills: ['MILITARY'],
			},
		}),
		plus(makeDef({ id: 'foc', suit: 'CARGO', operations: [] }), {
			focus: 'FOCUS_RESEARCH',
		}),
	])
	let s = fresh()
	// staged ANY (counts) + deployed RESEARCH + a beamed military card + a beamed variable card
	s = place(s, 'any', ID('A'), { k: 'STAGING', seat: 0 }, 0)
	s = place(s, 'res', ID('R'), { k: 'FLEET', seat: 0 }, 0)
	s = place(s, 'mil', ID('M'), { k: 'BEAMED', host: ID('R') }, 0)
	s = place(s, 'var', ID('V'), { k: 'BEAMED', host: ID('R') }, 0)
	s = place(s, 'mil2', ID('M2'), { k: 'STAGING', seat: 0 }, 0)
	// focus-bearing cards wherever they are, both seats
	s = place(s, 'foc', ID('F1'), { k: 'HAND', seat: 0 }, 0)
	s = place(s, 'foc', ID('F2'), { k: 'DISCARD', seat: 0 }, 0)
	s = place(s, 'foc', ID('F3'), { k: 'BEAMED', host: ID('R') }, 0)
	s = place(s, 'foc', ID('F4'), { k: 'HAND', seat: 1 }, 1)
	return s
}

describe('countSkillIcons (rules/12 §12.3/§12.5, rules/09 §9.1)', () => {
	it('counts staged and deployed skills, and lets SKILL_ANY count as the queried specialty', () => {
		const s = iconBoard()
		assertSerialisable(s)
		// RESEARCH: R (1) + ANY (1) — the beamed M and V never count
		expect(countSkillIcons(s, 0, 'RESEARCH')).toBe(2)
		// MILITARY: M2 (staged) + ANY (staged) = 2 — the beamed M and V are excluded
		expect(countSkillIcons(s, 0, 'MILITARY')).toBe(2)
		expect(countSkillIcons(s, 0, 'INFLUENCE')).toBe(1) // only the ANY card
	})

	it('SKILL_ANY counts independently for each specialty being counted (per use)', () => {
		const s = iconBoard()
		expect(countSkillIcons(s, 0, 'INFLUENCE')).toBe(1) // the SAME ANY card counts as Influence here
		expect(countSkillIcons(s, 0, 'RESEARCH')).toBe(2)
	})

	it('SKILL_VARIABLE counts only while its condition holds, then as the listed specialty', () => {
		register([
			plus(makeDef({ id: 'bur122', suit: 'PERSON', operations: [] }), {
				skills: ['SKILL_VARIABLE'],
				variableSkill: {
					condition: {
						k: 'SPECIALTY_AT_LEAST',
						specialty: 'RESEARCH',
						value: 2,
					},
					skills: ['MILITARY'],
				},
			}),
		])
		let low = fresh()
		low = place(low, 'bur122', ID('W'), { k: 'STAGING', seat: 0 }, 0)
		low = setSpecialty(low, 0, 'RESEARCH', 1) // condition unmet
		expect(countSkillIcons(low, 0, 'MILITARY')).toBe(0)
		expect(countSkillIcons(low, 0, 'RESEARCH')).toBe(0)
		const high = setSpecialty(low, 0, 'RESEARCH', 2) // condition met → counts as MILITARY
		expect(countSkillIcons(high, 0, 'MILITARY')).toBe(1)
		expect(countSkillIcons(high, 0, 'RESEARCH')).toBe(0) // variable skill is military-only
	})
})

describe('countFocusIcons (rules/07 §7.4.1 #5)', () => {
	it('counts focus icons on EVERY owned card, wherever it is (hand, discard, beamed)', () => {
		const s = iconBoard()
		assertSerialisable(s)
		expect(countFocusIcons(s, 0, 'RESEARCH')).toBe(3) // F1 (hand), F2 (discard), F3 (beamed)
		expect(countFocusIcons(s, 1, 'RESEARCH')).toBe(1) // F4
		expect(countFocusIcons(s, 0, 'MILITARY')).toBe(0)
	})
})

describe('exhibitsSpecialty (rules/07 §7.1.3)', () => {
	it('Skill or Focus of the colour counts', () => {
		const skill = plus(makeDef({ id: 's', suit: 'PERSON', operations: [] }), {
			skills: ['SKILL_MILITARY'],
		})
		const focus = plus(makeDef({ id: 'f', suit: 'PERSON', operations: [] }), {
			focus: 'FOCUS_MILITARY',
		})
		const any = plus(makeDef({ id: 'a', suit: 'PERSON', operations: [] }), {
			skills: ['SKILL_ANY'],
		})
		const variable = plus(
			makeDef({ id: 'v', suit: 'PERSON', operations: [] }),
			{
				skills: ['SKILL_VARIABLE'],
				variableSkill: {
					condition: {
						k: 'SPECIALTY_AT_LEAST',
						specialty: 'RESEARCH',
						value: 2,
					},
					skills: ['MILITARY'],
				},
			},
		)
		expect(exhibitsSpecialty(skill, 'MILITARY')).toBe(true)
		expect(exhibitsSpecialty(focus, 'MILITARY')).toBe(true)
		expect(exhibitsSpecialty(any, 'MILITARY')).toBe(true)
		expect(exhibitsSpecialty(variable, 'MILITARY')).toBe(true)
	})

	it('negative: never the wrong colour, never a restriction-only card', () => {
		const militaryOnly = plus(
			makeDef({ id: 'm', suit: 'PERSON', operations: [] }),
			{ skills: ['SKILL_MILITARY'] },
		)
		const bare = makeDef({ id: 'b', suit: 'PERSON', operations: [] })
		// a card bearing ONLY a restriction operation has no skill/focus of that colour
		expect(exhibitsSpecialty(militaryOnly, 'RESEARCH')).toBe(false)
		expect(exhibitsSpecialty(militaryOnly, 'INFLUENCE')).toBe(false)
		expect(exhibitsSpecialty(bare, 'RESEARCH')).toBe(false)
		expect(exhibitsSpecialty(bare, 'MILITARY')).toBe(false)
	})
})
