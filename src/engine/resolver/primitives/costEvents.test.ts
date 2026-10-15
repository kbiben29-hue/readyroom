// Cost-paid card moves raise the same events as their non-cost primitives
// (COST_DISMISS ≡ DISMISS → CARD_DISMISSED, COST_DISCARD ≡ DISCARD →
// CARD_DISCARDED, COST_LOG / COST_LOG_THIS ≡ LOG → CARD_LOGGED). A "when a card
// is dismissed/discarded/logged" reaction cannot tell a cost from an effect.

import { describe, expect, it } from 'vitest'
import type { Effect } from '../nodes'
import type { GameEvent, GameState, Frame } from '../../state'
import { costDismiss } from './costDismiss'
import { dismiss } from './dismiss'
import { costDiscard } from './costDiscard'
import { discard } from './discard'
import { costLog } from './costLog'
import { costLogThis } from './costLogThis'
import { log } from './log'
import { fresh, register, makeDef, place, makeCtx, ID } from '../testUtils'

const FRAME = {
	k: 'EFFECT',
	node: { k: 'NOOP' },
	ctx: makeCtx(0, ID('src')),
	ip: 0,
} as Extract<Frame, { k: 'EFFECT' }>

function setup(): GameState {
	register([makeDef({ id: 'ce-card', suit: 'CARGO', operations: [] })])
	let s = fresh()
	s = place(s, 'ce-card', ID('F'), { k: 'FLEET', seat: 0 }, 0)
	s = place(s, 'ce-card', ID('H'), { k: 'HAND', seat: 0 }, 0)
	return { ...s, eventQueue: [] }
}

const kinds = (s: GameState): GameEvent[] => s.eventQueue

describe('cost primitives emit the same events as their effect twins', () => {
	it('COST_DISMISS emits CARD_DISMISSED like DISMISS', () => {
		const s = setup()
		const cost = costDismiss.execute(
			s,
			{ k: 'COST_DISMISS', count: 1 } as Extract<Effect, { k: 'COST_DISMISS' }>,
			makeCtx(0, ID('src')),
			FRAME,
		)
		const eff = dismiss.execute(
			s,
			{ k: 'DISMISS', target: { zones: ['IN_PLAY'], seat: 'SELF' } } as Extract<
				Effect,
				{ k: 'DISMISS' }
			>,
			makeCtx(0, ID('src')),
			FRAME,
		)
		expect(cost.cards[ID('F')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		expect(kinds(cost)).toEqual(kinds(eff))
		expect(kinds(cost)).toContainEqual({
			k: 'CARD_DISMISSED',
			iid: ID('F'),
			seat: 0,
		})
	})

	it('COST_DISCARD emits CARD_DISCARDED like DISCARD', () => {
		const s = setup()
		const cost = costDiscard.execute(
			s,
			{ k: 'COST_DISCARD', count: 1 },
			makeCtx(0, ID('src')),
			FRAME,
		)
		const eff = discard.execute(
			s,
			{ k: 'DISCARD', count: 1 } as Extract<Effect, { k: 'DISCARD' }>,
			makeCtx(0, ID('src')),
			FRAME,
		)
		expect(cost.cards[ID('H')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		expect(kinds(cost)).toEqual(kinds(eff))
		expect(kinds(cost)).toContainEqual({
			k: 'CARD_DISCARDED',
			iid: ID('H'),
			seat: 0,
		})
	})

	it('COST_LOG and COST_LOG_THIS emit CARD_LOGGED like LOG', () => {
		const s = setup()
		const eff = log.execute(
			s,
			{ k: 'LOG', target: 'THIS' } as Extract<Effect, { k: 'LOG' }>,
			makeCtx(0, ID('F')),
			FRAME,
		)
		const cost = costLog.execute(
			s,
			{ k: 'COST_LOG' } as Extract<Effect, { k: 'COST_LOG' }>,
			makeCtx(0, ID('src')),
			FRAME,
		)
		const costThis = costLogThis.execute(
			s,
			{ k: 'COST_LOG_THIS' },
			makeCtx(0, ID('F')),
			FRAME,
		)
		const expected = { k: 'CARD_LOGGED', iid: ID('F'), seat: 0 }
		expect(kinds(eff)).toContainEqual(expected)
		expect(kinds(cost)).toEqual(kinds(eff))
		expect(kinds(costThis)).toEqual(kinds(eff))
		expect(costThis.cards[ID('F')]!.zone).toEqual({ k: 'LOG', seat: 0 })
	})
})
