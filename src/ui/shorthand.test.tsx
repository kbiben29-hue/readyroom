// <ShorthandOp> renders the engine's compiled tokens (src/engine/shorthand.ts).
// The engine test pins the tokens; this checks the drawing: every catalogue
// operation renders, a screen reader gets the English sentence, and each
// glyph carries its word as a hover title.

import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Operation } from '../engine/resolver/nodes'
import { describeOperation } from '../engine/describe'
import type { CardCatalog } from '../engine/setup'
import { loadBrowserCatalog } from './browserCatalog'
import { ShorthandOp } from './shorthand'

function mount(el: ReactElement): HTMLElement {
	const host = document.createElement('div')
	host.innerHTML = renderToStaticMarkup(el)
	return host
}

let catalog: CardCatalog
/** 1PIC02's "spend 1 {DIL} to warp this ship" activation */
let warp: Operation
beforeAll(() => {
	catalog = loadBrowserCatalog()
	const op = catalog.defs.find((d) => d.id === '1PIC02-24')?.operations[1]
	if (op === undefined) throw new Error('1PIC02-24 activation missing')
	warp = op
})

describe('<ShorthandOp>', () => {
	it('labels the line with the English operation for assistive tech', () => {
		const host = mount(<ShorthandOp op={warp} />)
		expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
			describeOperation(warp),
		)
	})

	it('draws the timing mark, the cost group and titled glyphs', () => {
		const container = mount(<ShorthandOp op={warp} />)
		expect(container.querySelector('.sh-tm-table')).not.toBeNull()
		const cost = container.querySelector('.sh-cost')
		expect(cost?.textContent).toBe('−1')
		expect(cost?.querySelector('[title="Dilithium"]')).not.toBeNull()
		expect(container.querySelector('.sh-then')).not.toBeNull()
		expect(container.querySelector('[title="warp a SHIP"]')).not.toBeNull()
	})

	it('renders every operation in the catalogue', () => {
		let lines = 0
		for (const def of catalog.defs) {
			for (const op of def.operations) {
				const container = mount(<ShorthandOp op={op} />)
				expect(
					container.querySelector('.sh-line'),
					`${def.id} ${op.type}`,
				).not.toBeNull()
				lines++
			}
		}
		expect(lines).toBeGreaterThan(550)
	})
})
