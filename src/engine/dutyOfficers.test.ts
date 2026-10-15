// Duty Officer slots, promote-at-the-limit and the slot/hand-size passives
// (rules/08 `promote`; 1PIC07, 1SEL08, 1BUR06, 1PER01, 1BUR08, 1SEL05,
// 1SIS23, 1SIS13 — card text per the STCC database).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CardArraySchema, type CardDef } from '../data/schema'
import type { Effect } from './resolver/nodes'
import type { GameState } from './state'
import { zoneKey } from './state'
import {
	ID,
	fresh,
	makeDef,
	place,
	pushAndRun,
	register,
	setSpecialty,
} from './resolver/testUtils'
import { applyChoice } from './resolver'
import { run } from './resolver/stack'
import { dutyOfficerSlots, dutyOfficers } from './dutyOfficers'
import { effectiveHandSize } from './modifiers'
import { canPlay } from './queries/legality'
import { describe as describeEffect } from './describe'

const defsOf = (file: string): CardDef[] =>
	CardArraySchema.parse(
		JSON.parse(
			readFileSync(join(__dirname, `../data/cards/${file}.json`), 'utf8'),
		),
	)
const byCardId = (file: string, cardId: string): CardDef =>
	defsOf(file).find((d) => d.cardId === cardId)!

const STARBASE = byCardId('crew/pic', '1PIC07/24')
const SINGULARITY = byCardId('crew/sel', '1SEL08/24')
const SEL05 = byCardId('crew/sel', '1SEL05/24')
const BUR06 = byCardId('crew/bur', '1BUR06/26')
const BUR08 = byCardId('crew/bur', '1BUR08/26')
const PER01 = byCardId('common/person', '1PER01/25')
const PER08 = byCardId('common/person', '1PER08/25')
const OBRIEN = byCardId('crew/sis', '1SIS13/25')
const SIS23 = byCardId('crew/sis', '1SIS23/25')

register([
	STARBASE,
	SINGULARITY,
	SEL05,
	BUR06,
	BUR08,
	PER01,
	PER08,
	OBRIEN,
	SIS23,
	makeDef({ id: 'do-plain', suit: 'PERSON', operations: [] }),
	makeDef({
		id: 'do-starfleet',
		suit: 'PERSON',
		traits: ['STARFLEET'],
		operations: [],
	}),
])

const DO0 = { k: 'DUTY_OFFICER', seat: 0 } as const
const HAND0 = { k: 'HAND', seat: 0 } as const
const PROMOTE_HAND: Effect = { k: 'PROMOTE', from: 'HAND' }
const SRC = ID('src')

function zoneOf(s: GameState, iid: string): string | undefined {
	const c = s.cards[iid]
	return c === undefined ? undefined : zoneKey(c.zone)
}

function answer(state: GameState, selection: unknown): GameState {
	const ch = state.pendingChoice
	if (ch === null) throw new Error('expected a pending choice')
	return run(
		applyChoice(state, {
			t: 'RESOLVE_CHOICE',
			choiceId: ch.id,
			selection,
		} as never),
	)
}

describe('PROMOTE at the Duty Officer limit (rules/08 promote)', () => {
	it('dismisses the current Duty Officer to make room instead of refusing', () => {
		let s = fresh()
		s = place(s, 'do-plain', ID('a'), DO0, 0)
		s = place(s, 'do-plain', ID('b'), HAND0, 0)
		s = pushAndRun(s, PROMOTE_HAND, SRC, 0)
		expect(s.pendingChoice).toBeNull()
		expect(zoneOf(s, 'b')).toBe('DUTY_OFFICER:0')
		expect(zoneOf(s, 'a')).toBe('DISCARD:0')
	})

	it('asks which Duty Officer to dismiss when several could make room', () => {
		let s = fresh()
		s = place(s, STARBASE.id, ID('sb'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		s = place(s, 'do-plain', ID('a'), DO0, 0)
		s = place(s, 'do-plain', ID('a2'), DO0, 0)
		s = place(s, 'do-plain', ID('b'), HAND0, 0)
		s = pushAndRun(s, PROMOTE_HAND, SRC, 0)
		const ch = s.pendingChoice
		expect(ch?.k).toBe('CHOOSE_CARDS')
		if (ch?.k === 'CHOOSE_CARDS')
			expect([...ch.candidates].sort()).toEqual(['a', 'a2'])
		s = answer(s, [ID('a2')])
		expect(dutyOfficers(s, 0).sort()).toEqual(['a', 'b'])
		expect(zoneOf(s, 'a2')).toBe('DISCARD:0')
	})
})

describe('extra Duty Officer slots', () => {
	it('1PIC07: an additional PERSON on duty (not hand size)', () => {
		let s = fresh()
		const base = effectiveHandSize(s, 0)
		s = place(s, STARBASE.id, ID('sb'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		expect(effectiveHandSize(s, 0)).toBe(base)
		expect(dutyOfficerSlots(s, 0)).toHaveLength(2)
		s = place(s, 'do-plain', ID('a'), DO0, 0)
		s = place(s, 'do-plain', ID('b'), HAND0, 0)
		s = pushAndRun(s, PROMOTE_HAND, SRC, 0)
		expect(dutyOfficers(s, 0).sort()).toEqual(['a', 'b'])
		expect(describeEffect({ k: 'MODIFIER_ATTACH', id: '1PIC07_DUTY' })).toBe(
			'You may have an additional PERSON on duty.',
		)
	})

	it('1SEL08: the slot needs MILITARY 3+ and a table position', () => {
		let s = fresh()
		s = place(s, SINGULARITY.id, ID('fs'), { k: 'FLEET', seat: 0 }, 0)
		s = setSpecialty(s, 0, 'MILITARY', 2)
		expect(dutyOfficerSlots(s, 0)).toHaveLength(1)
		s = setSpecialty(s, 0, 'MILITARY', 3)
		expect(dutyOfficerSlots(s, 0)).toHaveLength(2)
		// in the Staging Area its table operations (incl. PASSIVE) are off
		let staged = fresh()
		staged = setSpecialty(staged, 0, 'MILITARY', 5)
		staged = place(
			staged,
			SINGULARITY.id,
			ID('fs'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		expect(dutyOfficerSlots(staged, 0)).toHaveLength(1)
	})

	it('over the limit after a threshold drops: a Duty Officer must be dismissed', () => {
		let s = fresh()
		s = place(s, SINGULARITY.id, ID('fs'), { k: 'FLEET', seat: 0 }, 0)
		s = setSpecialty(s, 0, 'MILITARY', 3)
		s = place(s, 'do-plain', ID('a'), DO0, 0)
		s = place(s, 'do-plain', ID('b'), DO0, 0)
		s = pushAndRun(s, { k: 'NOOP' }, SRC, 0)
		expect(s.pendingChoice).toBeNull()
		s = setSpecialty(s, 0, 'MILITARY', 2)
		s = pushAndRun(s, { k: 'NOOP' }, SRC, 0)
		expect(s.pendingChoice?.k).toBe('CHOOSE_CARDS')
		s = answer(s, [ID('b')])
		expect(dutyOfficers(s, 0)).toEqual(['a'])
		expect(zoneOf(s, 'b')).toBe('DISCARD:0')
	})

	it('1BUR06: the extra slot only takes a SCIENTIST/ENGINEER', () => {
		let s = fresh()
		s = place(s, BUR06.id, ID('bur06'), DO0, 0)
		const slots = dutyOfficerSlots(s, 0)
		expect(slots).toHaveLength(2)
		expect(slots[1]!.traits).toEqual(['SCIENTIST', 'ENGINEER'])
		// 1BUR06 herself (no SCIENTIST/ENGINEER) holds the open slot, so a plain
		// PERSON only gets in by dismissing her (and her slot goes with her)
		s = place(s, 'do-plain', ID('p'), HAND0, 0)
		s = pushAndRun(s, PROMOTE_HAND, SRC, 0)
		expect(dutyOfficers(s, 0)).toEqual(['p'])
		expect(effectiveHandSize(s, 0)).toBe(effectiveHandSize(fresh(), 0))
	})

	it('1PER01: an extra STARFLEET slot; no playing/promoting ATTACK cards', () => {
		let s = fresh()
		s = place(s, PER01.id, ID('per01'), DO0, 0)
		s = place(s, 'do-starfleet', ID('sf'), HAND0, 0)
		s = place(s, PER08.id, ID('per08'), HAND0, 0)
		// 1PER08 prints an Attack Play: neither playable nor promotable
		expect(canPlay(s, 0, ID('per08')).ok).toBe(false)
		s = pushAndRun(s, PROMOTE_HAND, SRC, 0)
		expect(s.pendingChoice).toBeNull() // only the STARFLEET PERSON qualifies
		expect(dutyOfficers(s, 0).sort()).toEqual(['per01', 'sf'])
		expect(zoneOf(s, 'per08')).toBe('HAND:0')
	})
})

describe('1BUR08', () => {
	it('+1 hand size per RESEARCH/INFLUENCE/MILITARY at 5+', () => {
		let s = fresh()
		const base = effectiveHandSize(s, 0)
		s = place(s, BUR08.id, ID('bur08'), DO0, 0)
		s = setSpecialty(s, 0, 'RESEARCH', 5)
		s = setSpecialty(s, 0, 'INFLUENCE', 4)
		s = setSpecialty(s, 0, 'MILITARY', 7)
		expect(effectiveHandSize(s, 0)).toBe(base + 2)
		s = setSpecialty(s, 0, 'INFLUENCE', 5)
		expect(effectiveHandSize(s, 0)).toBe(base + 3)
	})
})

describe('PROMOTE this card / cannot be promoted', () => {
	it('1SEL05 and 1SIS23 promote only themselves', () => {
		for (const def of [SEL05, SIS23]) {
			const text = JSON.stringify(def.operations)
			expect(text).toContain('"k":"PROMOTE","from":"STAGING","target":"THIS"')
		}
		let s = fresh()
		s = place(s, SIS23.id, ID('sis23'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'do-plain', ID('other'), { k: 'STAGING', seat: 0 }, 0)
		s = pushAndRun(
			s,
			{ k: 'PROMOTE', from: 'STAGING', target: 'THIS' },
			ID('sis23'),
			0,
		)
		expect(s.pendingChoice).toBeNull()
		expect(dutyOfficers(s, 0)).toEqual(['sis23'])
		expect(zoneOf(s, 'other')).toBe('STAGING:0')
	})

	it('1SIS13 cannot be promoted', () => {
		expect(OBRIEN.cannotBePromoted).toBe(true)
		let s = fresh()
		s = place(s, OBRIEN.id, ID('obrien'), HAND0, 0)
		s = pushAndRun(s, PROMOTE_HAND, SRC, 0)
		expect(dutyOfficers(s, 0)).toEqual([])
		expect(zoneOf(s, 'obrien')).toBe('HAND:0')
	})
})
