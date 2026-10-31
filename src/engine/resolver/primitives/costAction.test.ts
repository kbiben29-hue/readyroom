// COST_ACTION leaves its action token on the card it paid for (rules/12
// §12.7: a reminder counter, never refunded) until Clean-up clears it.

import { describe, expect, it } from 'vitest'
import { fresh, register, makeDef, place, pushAndRun, setActions, ID } from '../testUtils'

register([makeDef({ id: 'chitHost', suit: 'SHIP', operations: [] })])

describe('COST_ACTION', () => {
	it('sets the spent action token on the source card', () => {
		let s = place(fresh(), 'chitHost', ID('h'), { k: 'FLEET', seat: 0 }, 0)
		s = setActions(s, 0, 3)
		s = pushAndRun(s, { k: 'COST_ACTION' }, ID('h'), 0)
		s = pushAndRun(s, { k: 'COST_ACTION' }, ID('h'), 0)
		expect(s.cards[ID('h')]!.actionTokens).toBe(2)
		expect(s.players[0].actions.available).toBe(1)
	})
})
