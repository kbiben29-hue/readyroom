// Reserved Borg keywords, recognised but inert in this box (rules/08 → drone /
// assimilate, rules/12 §12.30):
//   - DRONE + COLLECTIVE_AT_LEAST (1CAR02, errata wording
//     "Play {COL6}: Regenerate 1 drone …")
//   - ASSIMILATE (1SHI02 "If your captain is BORG, assimilate it
//     instead")
// The card sections run the REAL card JSON from src/data/cards.

import { beforeAll, describe, expect, it } from 'vitest'
import type { Effect } from './nodes'
import type { EffectCtx, GameState } from '../state'
import { zonesOf } from '../state'
import {
	fresh,
	register,
	makeDef,
	place,
	ID,
	play,
	pushAndRun,
} from './testUtils'
import { run } from './stack'
import { applyChoice } from './choices'
import { evalPredicate } from '../queries/resolveQuery'
import { describeOperation } from '../describe'
import { loadCatalog } from '../../data/catalog'
import { cardDef } from '../cards'

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

beforeAll(async () => {
	const catalog = await loadCatalog()
	register(catalog.defs)
	register([makeDef({ id: 'arr-card', suit: 'PERSON', operations: [] })])
})

describe('1CAR02 — drones are recognised but inert (rules/12 §12.30)', () => {
	it('op[0] costs an action; op[1] is gated on 6+ collective value (errata: no BORG-captain check)', () => {
		const def = cardDef('1CAR02-16')
		expect(def.operations[0]!.costsAction).toBe(true)
		expect(describeOperation(def.operations[1]!)).toContain(
			'If you have 6+ collective value, regenerate 1 drone.',
		)
	})

	it('collective value is 0 in this box, so the gate never opens', () => {
		const ctx: EffectCtx = { actor: 0, source: ID('src'), bindings: {} }
		expect(
			evalPredicate(fresh(), { k: 'COLLECTIVE_AT_LEAST', value: 6 }, ctx),
		).toBe(false)
		let s = fresh()
		s = place(s, '1CAR02-16', ID('bst'), { k: 'STAGING', seat: 0 }, 0)
		const before = JSON.stringify(s.cards)
		s = play(s, ID('bst'), { opIndex: 1 })
		expect(s.pendingChoice).toBeNull()
		expect(JSON.stringify(s.cards)).toBe(before)
	})

	it('a DRONE node is a logged no-op', () => {
		const s = pushAndRun(
			fresh(),
			{ k: 'DRONE', verb: 'REGENERATE', count: 1 },
			ID('src'),
			0,
		)
		expect(s.log.some((e) => e.message.startsWith('DRONE REGENERATE'))).toBe(
			true,
		)
	})
})

// ---------------------------------------------------------------------------
// ASSIMILATE — reserved Borg keyword (1SHI02)
// ---------------------------------------------------------------------------

describe('1SHI02 — "assimilate it instead" is recognised but inert (rules/12 §12.30)', () => {
	// The gain-and-log body of op[0]'s optional PAY_THEN, from the REAL card JSON.
	function gainBody(): Effect {
		const eff = cardDef('1SHI02-13').operations[0]!.effect
		if (eff.k !== 'SEQ') throw new Error('expected SEQ')
		const may = eff.steps[2]!
		if (may.k !== 'MAY' || may.body.k !== 'PAY_THEN')
			throw new Error('expected MAY(PAY_THEN)')
		return may.body.body
	}

	function gainAPerson(captainTraits: 'BORG' | 'HUMAN', dest: string) {
		let s = fresh()
		s = place(s, 'arr-card', ID('gp'), { k: 'MARKET_OFFER', suit: 'PERSON' })
		s = place(
			s,
			captainTraits === 'BORG' ? 'borg-cap' : 'human-cap',
			ID('cap'),
			{ k: 'CAPTAIN', seat: 0 },
			0,
		)
		const halted = pushAndRun(s, gainBody(), ID('probe'), 0)
		const ch = halted.pendingChoice
		if (ch === null || ch.k !== 'CHOOSE_DESTINATION')
			throw new Error('expected CHOOSE_DESTINATION')
		return answer(halted, dest)
	}

	beforeAll(() => {
		register([
			makeDef({
				id: 'borg-cap',
				suit: 'PERSON',
				traits: ['BORG'],
				operations: [],
			}),
			makeDef({
				id: 'human-cap',
				suit: 'PERSON',
				traits: ['HUMAN'],
				operations: [],
			}),
		])
	})

	it('describes the replacement faithfully', () => {
		expect(describeOperation(cardDef('1SHI02-13').operations[0]!)).toContain(
			'If your captain has BORG, assimilate',
		)
	})

	it('without a BORG captain the gained PERSON is logged (from the Discard pile)', () => {
		const s = gainAPerson('HUMAN', 'DISCARD')
		expect(s.pendingChoice).toBeNull()
		expect(zonesOf(s, { k: 'LOG', seat: 0 })).toContain(ID('gp'))
	})

	it('without a BORG captain the gained PERSON is logged (from the top of the deck)', () => {
		const s = gainAPerson('HUMAN', 'DECK_TOP')
		expect(zonesOf(s, { k: 'LOG', seat: 0 })).toContain(ID('gp'))
		expect(zonesOf(s, { k: 'DRAW', seat: 0 })).not.toContain(ID('gp'))
	})

	it('with a BORG captain it is assimilated INSTEAD: a logged no-op, the card is not logged', () => {
		const s = gainAPerson('BORG', 'DISCARD')
		expect(s.pendingChoice).toBeNull()
		expect(zonesOf(s, { k: 'LOG', seat: 0 })).not.toContain(ID('gp'))
		expect(zonesOf(s, { k: 'DISCARD', seat: 0 })).toContain(ID('gp'))
		expect(s.log.some((e) => e.message.startsWith('ASSIMILATE '))).toBe(true)
	})

	it('an ASSIMILATE node never moves anything', () => {
		const s0 = place(fresh(), 'arr-card', ID('x'), { k: 'HAND', seat: 0 }, 0)
		const s = pushAndRun(s0, { k: 'ASSIMILATE', target: 'THIS' }, ID('x'), 0)
		expect(zonesOf(s, { k: 'HAND', seat: 0 })).toContain(ID('x'))
		expect(s.log.some((e) => e.message.startsWith('ASSIMILATE'))).toBe(true)
	})
})
