// A Location in play always shows its Away Teams and the ships standing on it,
// wherever it is drawn: the board, the Location choice ("Warp to which
// Location?") and the phone's card tile.

import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { ReactNode } from 'react'
import type { CardInstanceId } from '../engine/ids'
import { ChoicePanel } from './choice'
import { LocationCard } from './location'
import { CardTile } from './tile/CardTile'
import { useGameStore } from './store'

function render(node: ReactNode): HTMLElement {
	const host = document.createElement('div')
	document.body.appendChild(host)
	act(() => {
		createRoot(host).render(node)
	})
	return host
}

/** A fresh game whose view has Away Teams (P1 1, P2 2) and one ship per seat at
 *  the first Neutral Zone Location, and nothing at the second (UI-only: the
 *  view is patched directly). */
function busyLocation(): { busy: CardInstanceId; quiet: CardInstanceId } {
	act(() => {
		useGameStore.getState().startGame({
			mode: 'TWO_PLAYER',
			players: [
				{ deck: 'PIC', boardSide: 'BASIC' },
				{ deck: 'SHR', boardSide: 'BASIC' },
			],
			seed: 7,
		})
	})
	const p = useGameStore.getState().projected!
	const busy = p.zones['NEUTRAL_ZONE:0']![0]!
	const quiet = p.zones['NEUTRAL_ZONE:1']![0]!
	const cards = { ...p.cards }
	const ships = Object.values(p.cards)
		.filter((c) => c.zone.k === 'HAND')
		.slice(0, 2)
		.map((c) => c.iid)
	ships.forEach((iid, i) => {
		const seat = i as 0 | 1
		cards[iid] = {
			...cards[iid]!,
			zone: { k: 'FLEET', seat },
			owner: seat,
			shipTokenAt: busy,
		}
	})
	act(() => {
		useGameStore.setState({
			projected: {
				...p,
				cards,
				awayTeamsAt: { ...p.awayTeamsAt, [busy]: [1, 2], [quiet]: [0, 0] },
			},
		})
	})
	return { busy, quiet }
}

function teamsAndShips(el: Element) {
	return {
		teams: [...el.querySelectorAll('.away-stack')].map((s) =>
			s.getAttribute('aria-label'),
		),
		ships: el.querySelectorAll('.standee').length,
	}
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
})

describe('Location card', () => {
	it('draws the Away Teams down its edges and the ships on it', () => {
		const { busy } = busyLocation()
		const host = render(<LocationCard iid={busy} />)
		expect(teamsAndShips(host)).toEqual({
			teams: ['P1: 1 Away Team', 'P2: 2 Away Teams'],
			ships: 2,
		})
	})

	it('shows them on every candidate of the Location choice', () => {
		const { busy, quiet } = busyLocation()
		act(() => {
			useGameStore.setState({
				pendingChoice: {
					k: 'CHOOSE_LOCATION',
					id: 'c-test',
					seat: 0,
					prompt: 'Warp to which Location?',
					candidates: [busy, quiet],
					sourceCard: null,
				},
				botToMove: null,
			})
		})
		const host = render(<ChoicePanel />)
		const tiles = [...host.querySelectorAll('.location-tile')]
		expect(tiles.map(teamsAndShips)).toEqual([
			{ teams: ['P1: 1 Away Team', 'P2: 2 Away Teams'], ships: 2 },
			{ teams: [], ships: 0 },
		])
	})

	it('carries the ships on the phone tile, without buttons when inert', () => {
		const { busy } = busyLocation()
		const live = render(<CardTile iid={busy} />)
		expect(live.querySelectorAll('button.standee')).toHaveLength(2)
		const inert = render(<CardTile iid={busy} interactive={false} />)
		expect(inert.querySelectorAll('.standee')).toHaveLength(2)
		expect(inert.querySelectorAll('button.standee')).toHaveLength(0)
	})
})
