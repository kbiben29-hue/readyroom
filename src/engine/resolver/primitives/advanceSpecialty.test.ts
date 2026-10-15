// §10 (todo/04): ADVANCE_SPECIALTY routes through evalAmount and clamps at 15
// (rules/07 §7.1); the 'CHOICE' variant suspends for the specialty pick first.

import { describe, expect, it } from 'vitest'
import { fresh, ID, setSpecialty, pushAndRun } from '../testUtils'
import { run } from '../stack'
import { applyChoice } from '../choices'

describe('ADVANCE_SPECIALTY', () => {
	it('advances by an evalAmount and clamps at 15', () => {
		let s = setSpecialty(fresh(), 0, 'INFLUENCE', 14)
		s = pushAndRun(
			s,
			{ k: 'ADVANCE_SPECIALTY', specialty: 'INFLUENCE', amount: 4 },
			ID('src'),
			0,
		)
		expect(s.players[0]!.specialties.INFLUENCE).toBe(15)
	})

	it('CHOICE suspends a CHOOSE_SPECIALTY pick before advancing', () => {
		let s = setSpecialty(fresh(), 0, 'MILITARY', 3)
		s = pushAndRun(
			s,
			{ k: 'ADVANCE_SPECIALTY', specialty: 'CHOICE', amount: 1 },
			ID('src'),
			0,
		)
		expect(s.pendingChoice?.k).toBe('CHOOSE_SPECIALTY')
		const id = s.pendingChoice!.id
		s = run(
			applyChoice(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: id,
				selection: 'MILITARY',
			}),
		)
		expect(s.players[0]!.specialties.MILITARY).toBe(4)
	})
})
