// Ship standees (standees.tsx): a ship whose token sits at a Location stands on
// that Location's card in the owner's colour, names itself in the tooltip and
// opens its own card detail on a click.

import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { ReactNode } from 'react'
import type { CardInstanceId } from '../engine/ids'
import { NeutralZone } from './board'
import { ShipPosition, ShipStandees, shipsAt } from './standees'
import { useGameStore } from './store'

function render(node: ReactNode): HTMLElement {
	const host = document.createElement('div')
	document.body.appendChild(host)
	act(() => {
		createRoot(host).render(node)
	})
	return host
}

/** A fresh game whose projected view has one ship per seat parked at the
 *  first Neutral Zone Location (UI-only: the view is patched directly). */
function parkShips(): { loc: CardInstanceId; ships: CardInstanceId[] } {
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
	const loc = p.zones['NEUTRAL_ZONE:0']![0]!
	const ships = Object.keys(p.cards).slice(0, 2) as CardInstanceId[]
	const cards = { ...p.cards }
	ships.forEach((iid, i) => {
		const seat = i as 0 | 1
		cards[iid] = {
			...cards[iid]!,
			zone: { k: 'FLEET', seat },
			owner: seat,
			shipTokenAt: loc,
		}
	})
	act(() => {
		useGameStore.setState({ projected: { ...p, cards } })
	})
	return { loc, ships }
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
})

describe('ship standees', () => {
	it('lists the deployed ships at a Location, P1 first', () => {
		const { loc, ships } = parkShips()
		const p = useGameStore.getState().projected!
		expect(shipsAt(p, loc).map((s) => s.iid)).toEqual(ships)
		// a ship that left the Fleet no longer stands anywhere
		const gone = {
			...p,
			cards: {
				...p.cards,
				[ships[1]!]: {
					...p.cards[ships[1]!]!,
					zone: { k: 'DISCARD' as const, seat: 1 as const },
				},
			},
		}
		expect(shipsAt(gone, loc).map((s) => s.iid)).toEqual([ships[0]])
	})

	it('stands each ship on its Neutral Zone Location in its owner colour', () => {
		parkShips()
		const host = render(<NeutralZone />)
		const standees = host.querySelectorAll<HTMLButtonElement>('.standee')
		expect(standees).toHaveLength(2)
		expect(standees[0]!.className).toContain('standee-seat-0')
		expect(standees[1]!.className).toContain('standee-seat-1')
		expect(standees[0]!.title).toMatch(/Player 1 \(you\)$/)
		expect(standees[1]!.title).toMatch(/Player 2 \(opponent\)$/)
	})

	it('opens the ship detail on a click without selecting the Location', () => {
		const { loc, ships } = parkShips()
		const host = render(<ShipStandees loc={loc} placement="inline" />)
		act(() => {
			host.querySelectorAll<HTMLButtonElement>('.standee')[1]!.click()
		})
		expect(useGameStore.getState().detailIid).toBe(ships[1])
		expect(useGameStore.getState().selected).toEqual([])
	})

	it('marks the Fleet card with where its ship stands', () => {
		const { loc, ships } = parkShips()
		const host = render(<ShipPosition ship={ships[0]!} />)
		const tab = host.querySelector<HTMLButtonElement>('.ship-at')!
		expect(tab.title).toMatch(/^At /)
		act(() => {
			tab.click()
		})
		expect(useGameStore.getState().detailIid).toBe(loc)
	})
})
