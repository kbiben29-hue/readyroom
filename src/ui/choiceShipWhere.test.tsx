// A CHOOSE_CARDS candidate that is a Fleet SHIP shows where its token is, so a
// choice like "beam to a SHIP … to send an Away Team where this ship is" names
// the destination on desktop (the phone tile already carries that chip).

import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { CardInstanceId } from '../engine/ids'
import { createSession } from '../session/log'
import { SessionAdapter } from '../session/adapter'
import { cardNameById } from '../data/cardNames'
import { loadBrowserCatalog } from './browserCatalog'
import { useGameStore } from './store'
import { ChoicePanel } from './choice'

function startedSession() {
	const catalog = loadBrowserCatalog()
	const adapter = new SessionAdapter({
		session: createSession(
			{
				mode: 'TWO_PLAYER' as const,
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
	return adapter.session
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
})

describe('CHOOSE_CARDS ship candidates', () => {
	it('say at which Location each Fleet ship is', () => {
		act(() => {
			useGameStore.getState().resumeGame(startedSession())
		})
		const projected = useGameStore.getState().projected!
		const loc = projected.zones['NEUTRAL_ZONE:0']![0]! as CardInstanceId
		// any two non-Location cards stand in as Fleet ships: one warped, one not
		const [warped, docked] = Object.values(projected.cards)
			.filter((c) => c.zone.k === 'HAND' && c.owner === 0)
			.map((c) => c.iid)
		const fleet = { k: 'FLEET', seat: 0 } as const
		act(() => {
			useGameStore.setState({
				projected: {
					...projected,
					cards: {
						...projected.cards,
						[warped!]: {
							...projected.cards[warped!]!,
							zone: fleet,
							shipTokenAt: loc,
						},
						[docked!]: {
							...projected.cards[docked!]!,
							zone: fleet,
							shipTokenAt: null,
						},
					},
				},
				pendingChoice: {
					k: 'CHOOSE_CARDS',
					id: 'c-test',
					seat: 0,
					prompt: 'Beam onto which card?',
					candidates: [warped!, docked!],
					min: 1,
					max: 1,
					from: 'IN_PLAY',
					sourceCard: null,
				},
				botToMove: null,
			})
		})
		const host = document.createElement('div')
		document.body.appendChild(host)
		const root = createRoot(host)
		act(() => root.render(<ChoicePanel />))
		const lines = [...host.querySelectorAll('.ship-where')].map(
			(el) => el.textContent,
		)
		const locName = cardNameById(projected.cards[loc]!.def)
		expect(lines).toEqual([`at ${locName}`, 'token on card'])
		act(() => root.unmount())
	})
})
