// Card art tests: the fetched card scan is the default card face; the
// Details toggle returns to the text card; cards without a scan (Stardate, no
// data fetched), image load failures, malformed data and hidden cards all fall
// back safely. Runs under the `dom` vitest project (jsdom) — Image is mocked
// for the load probe, and the STCC index is injected per test.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import type { CardDef } from '../data/schema'
import { CardFace, resetImageLoadCache } from './cards'
import { useGameStore } from './store'
import { loadBrowserCatalog } from './browserCatalog'
import { setStccIndex } from './stcc'
import { fakeStccIndex } from './testStcc'
import { cardName } from '../data/cardNames'

const catalog = loadBrowserCatalog()

/** A well-formed real-face def (PIC cards pass validation). */
const DEF: CardDef =
	catalog.defs.find((d) => d.deck === 'PIC' && d.cardId !== null) ??
	catalog.defs[0]!

/** Fake `Image`: resolves synchronously per src (or errors for every src when
 *  `mode === 'error'`), recording the requested srcs. */
let requestedSrcs: string[] = []

function installFakeImage(mode: 'load' | 'error'): void {
	requestedSrcs = []
	class FakeImage {
		naturalWidth = 0
		naturalHeight = 0
		onload: (() => void) | null = null
		onerror: (() => void) | null = null
		private _src = ''
		get src(): string {
			return this._src
		}
		set src(v: string) {
			this._src = v
			requestedSrcs.push(v)
			if (mode === 'error') {
				this.onerror?.()
			} else {
				this.naturalWidth = 1170
				this.naturalHeight = 1635
				this.onload?.()
			}
		}
	}
	vi.stubGlobal('Image', FakeImage)
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
	useGameStore.getState().setShowCardDetails(false)
	resetImageLoadCache()
	setStccIndex(fakeStccIndex([DEF]))
	installFakeImage('load')
})

afterEach(() => {
	vi.unstubAllGlobals()
	setStccIndex(new Map())
})

describe('card art', () => {
	it('renders the fetched scan as the card face', () => {
		const host = render(<CardFace def={DEF} size="hand" />)
		const img = host.querySelector<HTMLElement>('.card-art img')
		expect(img).not.toBeNull()
		expect(img!.getAttribute('src')).toBe(`/stcc/img/box1/${DEF.id}.jpg`)
		expect(img!.getAttribute('alt')).toBe('')
		// a11y: decorative img, named layer, no text card underneath
		const layer = host.querySelector('.card-art')
		expect(layer?.getAttribute('role')).toBe('img')
		expect(layer?.getAttribute('aria-label')).toBe(cardName(DEF))
		expect(host.querySelector('.card-name')).toBeNull()
		expect(host.querySelector('.card-ops')).toBeNull()
	})

	it('Details ON renders the full text card instead of the scan', () => {
		useGameStore.getState().setShowCardDetails(true)
		const host = render(<CardFace def={DEF} size="hand" />)
		expect(host.querySelector('.card-art')).toBeNull()
		expect(host.querySelector('.card-name')?.textContent).toContain(
			cardName(DEF),
		)
		expect(host.querySelector('.card-ops')).not.toBeNull()
	})

	it('keeps the live overlays on top of the scan', () => {
		const host = render(
			<CardFace
				def={DEF}
				size="board"
				actionTokens={2}
				resourceTokens={{ DIL: 3, LAT: 1 }}
				badge={<span className="test-badge">secured</span>}
			/>,
		)
		expect(host.querySelector('.card-art')).not.toBeNull()
		expect(host.querySelector('.card-badge .test-badge')).not.toBeNull()
		expect(host.querySelectorAll('.action-chip').length).toBe(2)
		const dil = host.querySelector('.res-pip.pip-dil')
		expect(dil?.getAttribute('title')).toContain('×3')
		expect(host.querySelector('.res-pip.pip-lat')).not.toBeNull()
	})

	it('a card with no scan (Stardate / nothing fetched) renders text and never requests an image', () => {
		setStccIndex(new Map())
		const host = render(<CardFace def={DEF} size="hand" />)
		expect(host.querySelector('.card-art')).toBeNull()
		expect(host.querySelector('.card-name')?.textContent).toContain(
			cardName(DEF),
		)
		expect(requestedSrcs.length).toBe(0)
	})

	it('a failing image falls back to the text card, never a broken image', () => {
		installFakeImage('error')
		const host = render(<CardFace def={DEF} size="hand" />)
		expect(host.querySelector('.card-art')).toBeNull()
		expect(host.querySelector('img')).toBeNull()
		expect(host.querySelector('.card-name')).not.toBeNull()
	})

	it('an environment without Image falls back to text without throwing', () => {
		vi.stubGlobal('Image', class {})
		expect(() => render(<CardFace def={DEF} size="hand" />)).not.toThrow()
		const host = render(<CardFace def={DEF} size="hand" />)
		expect(host.querySelector('.card-art')).toBeNull()
		expect(host.querySelector('.card-name')).not.toBeNull()
	})

	it('a hidden card still renders the CSS back', () => {
		const host = render(<CardFace def={DEF} hidden size="hand" />)
		expect(host.querySelector('.card-back')).not.toBeNull()
		expect(host.querySelector('.card-art')).toBeNull()
	})

	it('stores the Details preference with the right defaults and toggle', () => {
		const store = useGameStore.getState()
		expect(store.showCardDetails).toBe(false)
		act(() => {
			store.setShowCardDetails(true)
		})
		expect(useGameStore.getState().showCardDetails).toBe(true)
		act(() => {
			useGameStore.getState().setShowCardDetails(false)
		})
		expect(useGameStore.getState().showCardDetails).toBe(false)
	})
})
