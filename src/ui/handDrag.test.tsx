// Dropping a hand card on the table (handDrag.ts → store.cardDropped): a card
// with exactly one legal PLAY is played; anything else opens its detail.

import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import type { CardCatalog } from '../engine/setup'
import type { CardInstanceId } from '../engine/ids'
import type { GameState } from '../engine/state'
import { createSession, type Session } from '../session/log'
import { SessionAdapter } from '../session/adapter'
import { loadBrowserCatalog } from './browserCatalog'
import { useGameStore } from './store'
;(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let catalog: CardCatalog

const findDef = (s: GameState, key: string, def: string): CardInstanceId => {
	const iid = (s.zones[key] ?? []).find((i) => s.cards[i]!.def === def)
	if (iid === undefined) throw new Error(`test fixture: ${def} not in ${key}`)
	return iid
}

/** The seed-25 opening used by double-click.test.tsx: seat 0's ACTION step. */
function opening(): Session {
	const adapter = new SessionAdapter({
		session: createSession(
			{
				mode: 'TWO_PLAYER',
				players: [
					{ deck: 'PIC', boardSide: 'ADVANCED' },
					{ deck: 'SHR', boardSide: 'BASIC' },
				],
				seed: 25,
			},
			catalog,
		),
		catalog,
	})
	adapter.dispatch({ t: 'START' })
	adapter.dispatch({
		t: 'PLAY_CARD',
		iid: findDef(adapter.state, 'HAND:0', '1PIC23-24'),
		operationIndex: 0,
	})
	adapter.settle(findDef(adapter.state, 'NEUTRAL_ZONE:0', '1LOC16-20'))
	return adapter.session
}

beforeEach(() => {
	useGameStore.getState().newGame()
	catalog = loadBrowserCatalog()
})

describe('dragging a hand card onto the table', () => {
	it('plays a card that has exactly one legal way to be played', () => {
		act(() => useGameStore.getState().resumeGame(opening()))
		const iid = findDef(useGameStore.getState().state!, 'HAND:0', '1PIC18-24')
		act(() => useGameStore.getState().cardDropped(iid))
		const after = useGameStore.getState()
		expect(after.session!.log.at(-1)).toMatchObject({ t: 'PLAY_CARD', iid })
		expect(after.state!.zones['HAND:0']).not.toContain(iid)
	})

	it('opens the detail for a card that cannot be played', () => {
		act(() => useGameStore.getState().resumeGame(opening()))
		const st = useGameStore.getState()
		const blocked = st.state!.zones['HAND:0']!.find(
			(iid) => !st.legal.some((l) => l.t === 'PLAY_CARD' && l.iid === iid),
		)
		if (blocked === undefined) return // every card playable: nothing to check
		const logLen = st.session!.log.length
		act(() => useGameStore.getState().cardDropped(blocked))
		expect(useGameStore.getState().detailIid).toBe(blocked)
		expect(useGameStore.getState().session!.log.length).toBe(logLen)
	})
})
