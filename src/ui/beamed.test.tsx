// Beamed cards (beamed.tsx): a card in a ship's BEAMED zone shows as a chip
// under the ship and in its detail; the chip opens the beamed card, whose
// detail names the ship it is on.

import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { ReactNode } from 'react'
import type { CardInstanceId } from '../engine/ids'
import { BeamedChips, BeamedOnto } from './beamed'
import { useGameStore } from './store'

function render(node: ReactNode): HTMLElement {
	const host = document.createElement('div')
	document.body.appendChild(host)
	act(() => {
		createRoot(host).render(node)
	})
	return host
}

/** A fresh game whose projected view has two cards beamed onto one host
 *  (UI-only: the view is patched directly). */
function beamTwo(): { host: CardInstanceId; beamed: CardInstanceId[] } {
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
	const [host, ...beamed] = Object.keys(p.cards).slice(0, 3) as CardInstanceId[]
	const cards = { ...p.cards }
	for (const b of beamed)
		cards[b] = { ...cards[b]!, zone: { k: 'BEAMED', host: host! } }
	act(() => {
		useGameStore.setState({
			projected: {
				...p,
				cards,
				zones: { ...p.zones, [`BEAMED:${host}`]: beamed },
			},
		})
	})
	return { host: host!, beamed }
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
})

describe('beamed cards', () => {
	it('draws one chip per beamed card, and a click opens it', () => {
		const { host, beamed } = beamTwo()
		const el = render(<BeamedChips host={host} placement="board" />)
		const chips = el.querySelectorAll<HTMLButtonElement>('.beamed-chip')
		expect(chips).toHaveLength(2)
		expect(chips[0]!.getAttribute('aria-label')).toMatch(/^Beamed aboard: /)
		act(() => chips[1]!.click())
		expect(useGameStore.getState().detailIid).toBe(beamed[1])
	})

	it('draws nothing for a card with nothing beamed onto it', () => {
		const { beamed } = beamTwo()
		const el = render(<BeamedChips host={beamed[0]!} placement="inline" />)
		expect(el.querySelector('.beamed-chips')).toBeNull()
	})

	it('names the host ship, and opens it', () => {
		const { host } = beamTwo()
		const el = render(<BeamedOnto host={host} />)
		expect(el.textContent).toMatch(/^Beamed onto /)
		act(() => el.querySelector<HTMLButtonElement>('.beamed-chip')!.click())
		expect(useGameStore.getState().detailIid).toBe(host)
	})
})
