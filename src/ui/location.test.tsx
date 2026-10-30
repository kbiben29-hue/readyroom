// A Location in play always shows its Away Teams and the ships standing on it,
// wherever it is drawn: the board, the Location picker (the Location choice
// "Warp to which Location?" and a card choice that offers only Locations, both
// laid out by area), and the phone's card tile.

import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { ReactNode } from 'react'
import type { CardInstanceId } from '../engine/ids'
import type { PendingChoice } from '../engine/resolver/choices'
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

/** The Location picker's areas: each label with its Locations in board order,
 *  whether each can be picked, and the tokens drawn on it. */
function pickerAreas(host: Element) {
	return [...host.querySelectorAll('.location-groups .candidate-group')].map(
		(g) => ({
			label: g.querySelector('.candidate-group-label')?.textContent,
			tiles: [...g.querySelectorAll('.location-tile')].map((t) => ({
				pickable: t.querySelector('button.card-inner') !== null,
				...teamsAndShips(t),
			})),
		}),
	)
}

function pending(choice: PendingChoice) {
	act(() => {
		useGameStore.setState({ pendingChoice: choice, botToMove: null })
	})
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

	it('lays the Location choice out by area, tokens on every Location', () => {
		const { busy, quiet } = busyLocation()
		pending({
			k: 'CHOOSE_LOCATION',
			id: 'c-test',
			seat: 0,
			prompt: 'Warp to which Location?',
			candidates: [busy, quiet],
			sourceCard: null,
		})
		const host = render(<ChoicePanel />)
		expect(pickerAreas(host)).toEqual([
			{
				label: 'Neutral Zone',
				tiles: [
					{
						pickable: true,
						teams: ['P1: 1 Away Team', 'P2: 2 Away Teams'],
						ships: 2,
					},
					{ pickable: true, teams: [], ships: 0 },
					// not on offer, still shown for its tokens
					{ pickable: false, teams: [], ships: 0 },
				],
			},
		])
	})

	it('gives a card choice of Locations (SELECT) the same picker', () => {
		const { quiet } = busyLocation()
		const third =
			useGameStore.getState().projected!.zones['NEUTRAL_ZONE:2']![0]!
		pending({
			k: 'CHOOSE_CARDS',
			id: 'c-test',
			seat: 0,
			prompt: 'Choose a Location',
			candidates: [quiet],
			disabled: [{ iid: third, reason: 'no ship there' }],
			min: 1,
			max: 1,
			from: 'x',
			sourceCard: null,
		})
		const host = render(<ChoicePanel />)
		expect(pickerAreas(host)).toEqual([
			{
				label: 'Neutral Zone',
				tiles: [
					{
						pickable: false,
						teams: ['P1: 1 Away Team', 'P2: 2 Away Teams'],
						ships: 2,
					},
					{ pickable: true, teams: [], ships: 0 },
					{ pickable: false, teams: [], ships: 0 },
				],
			},
		])
		expect(host.querySelector('.why-not')?.textContent).toBe(
			'why not: no ship there',
		)
		// no raw zone keys as group labels
		expect(host.textContent).not.toContain('NEUTRAL_ZONE')

		act(() => {
			host
				.querySelectorAll<HTMLButtonElement>(
					'.location-tile button.card-inner',
				)[0]!
				.click()
		})
		expect(useGameStore.getState().selected).toEqual([quiet])
	})

	it("adds both Location Areas, the opponent's only when it offers one", () => {
		const { busy } = busyLocation()
		const p = useGameStore.getState().projected!
		const [mine, theirs] = [
			p.zones['NEUTRAL_ZONE:1']![0]!,
			p.zones['NEUTRAL_ZONE:2']![0]!,
		]
		act(() => {
			useGameStore.setState({
				projected: {
					...p,
					cards: {
						...p.cards,
						[mine]: {
							...p.cards[mine]!,
							zone: { k: 'LOCATION_AREA', seat: 0 },
						},
						[theirs]: {
							...p.cards[theirs]!,
							zone: { k: 'LOCATION_AREA', seat: 1 },
						},
					},
					zones: {
						...p.zones,
						'NEUTRAL_ZONE:1': [],
						'NEUTRAL_ZONE:2': [],
						'LOCATION_AREA:0': [mine],
						'LOCATION_AREA:1': [theirs],
					},
				},
			})
		})
		const labels = () =>
			pickerAreas(render(<ChoicePanel />)).map((a) => a.label)

		pending({
			k: 'CHOOSE_CARDS',
			id: 'c-test',
			seat: 0,
			prompt: 'Select a controlled Location',
			candidates: [mine],
			min: 1,
			max: 1,
			from: 'x',
			sourceCard: null,
		})
		expect(labels()).toEqual(['Your Location Area', 'Neutral Zone'])

		document.body.innerHTML = ''
		pending({
			k: 'CHOOSE_LOCATION',
			id: 'c-test',
			seat: 0,
			prompt: 'Choose a Location',
			candidates: [busy, theirs],
			sourceCard: null,
		})
		expect(labels()).toEqual([
			'Your Location Area',
			'Neutral Zone',
			"Opponent's Location Area",
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
