// Keyword links vs. clickable card faces: a clickable face is a <button>, so
// its op text must not hold keyword <button>s ("<button> cannot be a
// descendant of <button>"). On the face, keywords are inert terms and a click
// anywhere opens the card detail; the detail overlay's op text and printed
// text carry the live links, which open the rules drawer without acting as a
// card click.

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { ReactNode } from 'react'
import type { CardInstanceId } from '../engine/ids'
import type { SetupConfig } from '../engine/setup'
import App from './App'
import { loadBrowserCatalog } from './browserCatalog'
import { CardDetailHost } from './cards'
import { setStccIndex } from './stcc'
import { useGameStore } from './store'
import { fakeStccIndex } from './testStcc'

function config(): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: 'PIC', boardSide: 'BASIC' },
			{ deck: 'SHR', boardSide: 'BASIC' },
		],
		seed: 7,
	}
}

function render(node: ReactNode): HTMLElement {
	const host = document.createElement('div')
	document.body.appendChild(host)
	const root = createRoot(host)
	act(() => {
		root.render(node)
	})
	return host
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
	act(() => {
		useGameStore.getState().loadCatalog()
		useGameStore.getState().startGame(config())
		// The text faces (Details view) are where op text — and keywords — render.
		useGameStore.getState().setShowCardDetails(true)
	})
})

afterEach(() => {
	setStccIndex(new Map())
})

describe('keyword links on card faces', () => {
	it('never nests a button inside a clickable card face', () => {
		const host = render(<App />)
		expect(host.querySelectorAll('.card-inner').length).toBeGreaterThan(0)
		expect(host.querySelector('button button')).toBeNull()
		// board faces show the Shorthand only (the English, with its keywords,
		// is for the big views), so no keyword link sits inside a card button
		expect(host.querySelector('button.card-inner .keyword-link')).toBeNull()
	})

	it('the detail overlay links keywords to the rules drawer, not the card click', () => {
		const store = useGameStore.getState()
		const host = render(<CardDetailHost />)
		// open the detail for the first card whose op text has a keyword link
		const iids = Object.keys(store.state!.cards) as CardInstanceId[]
		const iid = iids.find((i) => {
			act(() => {
				store.setDetail(i)
			})
			return host.querySelector('.keyword-link') !== null
		})
		expect(iid).toBeDefined()
		expect(host.querySelector('button button')).toBeNull()

		act(() => {
			host.querySelector<HTMLButtonElement>('.keyword-link')!.click()
		})
		const after = useGameStore.getState()
		expect(after.rulesOpen).toBe(true)
		expect(after.detailIid).toBe(iid)
	})

	it('the detail overlay links keywords in the printed card text too', () => {
		const store = useGameStore.getState()
		const defs = new Map(loadBrowserCatalog().defs.map((d) => [d.id, d]))
		// a face-up card the viewer can see (deck cards project as face-down)
		const iid = store.state!.zones['HAND:0']!.find(
			(i) => defs.get(store.state!.cards[i]!.def)?.cardId != null,
		)!
		const def = defs.get(store.state!.cards[iid]!.def)!
		setStccIndex(fakeStccIndex([def], { hand: 'Draw 2 cards.' }))
		act(() => {
			store.setDetail(iid)
		})
		const host = render(<CardDetailHost />)

		const opened: unknown[] = []
		const onOpen = (e: Event) => opened.push((e as CustomEvent).detail)
		window.addEventListener('codex:open-rule', onOpen)
		act(() => {
			host
				.querySelector<HTMLButtonElement>('.printed-text .keyword-link')!
				.click()
		})
		window.removeEventListener('codex:open-rule', onOpen)

		expect(opened).toEqual(['DRAW'])
		expect(useGameStore.getState().rulesOpen).toBe(true)
		expect(useGameStore.getState().detailIid).toBe(iid)
	})
})
