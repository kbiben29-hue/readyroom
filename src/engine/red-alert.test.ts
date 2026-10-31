// Red Alert (1PIC20, 1SHR15, 1INC04, 3FRE25, 3RIK24): "Put a card on the top
// of your deck to return this card. You may promote a PERSON from your
// Staging Area to Duty Officer." Played the way a player would: the PLAY
// intent, then each choice answered.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CardArraySchema } from '../data/schema'
import { fresh, register, makeDef, place, setActions, ID } from './resolver/testUtils'
import { reduce } from './intents'
import { applyChoice } from './resolver/choices'
import { run } from './resolver/stack'
import type { GameState } from './state'

for (const file of ['crew/pic.json', 'common/incident.json']) {
	const raw: unknown = JSON.parse(
		readFileSync(join(__dirname, `../data/cards/${file}`), 'utf8'),
	)
	register(CardArraySchema.parse(raw))
}
register([
	makeDef({ id: 'raPerson', suit: 'PERSON', operations: [] }),
	makeDef({ id: 'raFiller', suit: 'CARGO', operations: [] }),
])

function answer(s: GameState, selection: unknown): GameState {
	const c = s.pendingChoice!
	return run(
		applyChoice(s, { t: 'RESOLVE_CHOICE', choiceId: c.id, selection: selection as never }),
	)
}

describe.each(['1PIC20-24', '1INC04-6'])('%s', (def) => {
	function table(): GameState {
		let s = fresh()
		s = setActions(s, 0, 3)
		s = place(s, def, ID('ra'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'raFiller', ID('f'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'raPerson', ID('p'), { k: 'STAGING', seat: 0 }, 0)
		return s
	}

	it('offers the promotion and promotes the PERSON from the Staging Area', () => {
		let s = reduce(table(), { t: 'PLAY_CARD', iid: ID('ra'), operationIndex: 0 }).state
		// put a card on the top of your deck (the only other card in hand)
		for (let guard = 0; s.pendingChoice !== null && guard < 5; guard++) {
			const c = s.pendingChoice
			if (c.k === 'CONFIRM') s = answer(s, true)
			else if (c.k === 'CHOOSE_CARDS') s = answer(s, c.candidates.slice(0, c.min || 1))
			else throw new Error(`unexpected ${c.k}: ${c.prompt}`)
		}
		expect(s.cards[ID('p')]!.zone).toEqual({ k: 'DUTY_OFFICER', seat: 0 })
	})
})
