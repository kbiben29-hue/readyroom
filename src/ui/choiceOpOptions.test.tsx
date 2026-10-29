// A CHOOSE_OPTION whose options are operations of a card (free play "resolve
// which play operation?") shows that card with each operation as a clickable
// block, not a list of text buttons; plain options keep the button list.

import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { CardInstanceId } from '../engine/ids'
import type { ChoiceOption } from '../engine/resolver/choices'
import { createSession } from '../session/log'
import { SessionAdapter } from '../session/adapter'
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

function renderOptions(options: (iid: CardInstanceId) => ChoiceOption[]) {
	act(() => {
		useGameStore.getState().resumeGame(startedSession())
	})
	const projected = useGameStore.getState().projected!
	const iid = Object.values(projected.cards).find(
		(c) => c.zone.k === 'HAND' && c.owner === 0,
	)!.iid
	act(() => {
		useGameStore.setState({
			pendingChoice: {
				k: 'CHOOSE_OPTION',
				id: 'c-test',
				seat: 0,
				prompt: 'Free play this card: resolve which play operation?',
				options: options(iid),
				sourceCard: null,
			},
			botToMove: null,
		})
	})
	const host = document.createElement('div')
	document.body.appendChild(host)
	const root = createRoot(host)
	act(() => root.render(<ChoicePanel />))
	return { host, root }
}

describe('CHOOSE_OPTION over operations of a card', () => {
	it('shows the card once, with one clickable block per operation', () => {
		const { host, root } = renderOptions((iid) => [
			{
				key: '0',
				label: 'Play: first',
				enabled: true,
				op: { card: iid, opIndex: 0 },
			},
			{
				key: '1',
				label: 'Play: second',
				enabled: true,
				op: { card: iid, opIndex: 0 },
			},
		])
		expect(host.querySelectorAll('.op-options-card')).toHaveLength(1)
		expect(
			host.querySelector('.op-options-sprite img, .op-options-sprite .card'),
		).not.toBeNull()
		const blocks = [...host.querySelectorAll('.op-options-list .op-detail')]
		expect(blocks).toHaveLength(2)
		expect(blocks.every((b) => b.classList.contains('op-detail-run'))).toBe(
			true,
		)
		expect(host.querySelector('.option-row')).toBeNull()
		act(() => root.unmount())
	})

	it('keeps the text buttons for options that are not operations', () => {
		const { host, root } = renderOptions(() => [
			{ key: 'a', label: 'Gain 1 {DIL}', enabled: true },
			{ key: 'b', label: 'Draw a card', enabled: true },
		])
		expect(host.querySelectorAll('.option-row')).toHaveLength(2)
		expect(host.querySelector('.op-options')).toBeNull()
		act(() => root.unmount())
	})
})
