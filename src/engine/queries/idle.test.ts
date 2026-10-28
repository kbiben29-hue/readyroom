// idleOperationReason: a legal operation that would skip every benefit is
// flagged for the UI (rules/12 §12.1–12.2 keep it legal). Real catalog.

import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from '../../data/catalog'
import { setup, type CardCatalog } from '../setup'
import { reduce } from '../intents'
import { moveCard, type GameState } from '../state'
import type { CardInstanceId } from '../ids'
import { canPlay, idleOperationReason } from './legality'

let catalog: CardCatalog
beforeAll(async () => {
	catalog = await loadCatalog()
})

/** Turn 1, SIS vs PIC, with 1SIS25-25 in seat 0's hand. */
function withRioGrande(): { state: GameState; iid: CardInstanceId } {
	let state = setup(
		{
			mode: 'TWO_PLAYER',
			players: [
				{ deck: 'SIS', boardSide: 'BASIC' },
				{ deck: 'PIC', boardSide: 'BASIC' },
			],
			seed: 1,
			startingSeat: 0,
		},
		catalog,
	)
	state = reduce(state, { t: 'START' }).state
	const card = Object.values(state.cards).find((c) => c.def === '1SIS25-25')!
	state = moveCard(state, card.iid, { k: 'HAND', seat: 0 })
	return { state, iid: card.iid }
}

describe('idleOperationReason', () => {
	it('flags a PLAY whose only benefit has no target, and keeps it legal', () => {
		const { state, iid } = withRioGrande()
		// no SHIP has warped to a LOCATION yet: "send an away team to a
		// LOCATION where you have a SHIP" has nowhere to go
		expect(canPlay(state, 0, iid).operations).toContain(2)
		expect(idleOperationReason(state, 0, iid, 2)).toMatch(/Away Team/i)
		// the other PLAYs do something
		expect(idleOperationReason(state, 0, iid, 0)).toBeNull()
		expect(idleOperationReason(state, 0, iid, 1)).toBeNull()
	})

	it('clears once a SHIP is at a LOCATION', () => {
		const { state, iid } = withRioGrande()
		const ship = Object.values(state.cards).find(
			(c) => c.owner === 0 && c.zone.k === 'FLEET',
		)!
		const loc = state.zones['NEUTRAL_ZONE:0']![0]!
		const warped: GameState = {
			...state,
			cards: { ...state.cards, [ship.iid]: { ...ship, shipTokenAt: loc } },
		}
		expect(idleOperationReason(warped, 0, iid, 2)).toBeNull()
	})
})
