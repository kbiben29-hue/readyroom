// The reaction window (OPTIONAL_TRIGGERS): one row per offered REACTION with
// its card, toggled by the row or its button, numbered in pick order when
// several are offered; the triggering card is shown face up when the choice
// names it, and left out (never a "??" card back) when nothing names it.

import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { CardInstanceId } from '../engine/ids'
import type { OperationRef } from '../engine/state'
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
					{ deck: 'PIC', boardSide: 'BASIC' },
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

function renderWindow(opts: {
	reactions: number
	/** stamp the face-down source card's def on the choice */
	named: boolean
}) {
	act(() => {
		useGameStore.getState().resumeGame(startedSession())
	})
	const cards = Object.values(useGameStore.getState().projected!.cards)
	const mine = (k: string) =>
		cards.filter((c) => c.zone.k === k && c.owner === 0).map((c) => c.iid)
	const reacting = [...mine('CAPTAIN'), ...mine('FLEET')].slice(
		0,
		opts.reactions,
	)
	const offered: OperationRef[] = reacting.map((card) => ({
		card,
		opIndex: 0,
		seat: 0,
	}))
	// a card that went face-down onto the deck top (a gain put there)
	const source = mine('DRAW')[0]! as CardInstanceId
	const sourceDef = useGameStore.getState().state!.cards[source]!.def
	act(() => {
		useGameStore.setState({
			pendingChoice: {
				k: 'OPTIONAL_TRIGGERS',
				id: 'c-test',
				seat: 0,
				prompt: 'Reaction window — use any of these, or none',
				offered,
				sourceCard: source,
				...(opts.named ? { sourceDef } : {}),
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

const buttons = (host: HTMLElement, label: RegExp) =>
	[...host.querySelectorAll('button')].filter((b) =>
		label.test(b.textContent ?? ''),
	)

describe('the reaction window', () => {
	it('lists each reaction with its card; picking numbers them in order', () => {
		const { host, root } = renderWindow({ reactions: 2, named: true })
		const rows = [...host.querySelectorAll<HTMLElement>('.reaction-row')]
		expect(rows).toHaveLength(2)
		expect(rows.every((r) => r.querySelector('.card') !== null)).toBe(true)
		const use = buttons(host, /^Use selected/)[0]!
		expect(use.disabled).toBe(true)
		expect(buttons(host, /^Skip all$/)).toHaveLength(1)

		// the second by its button, then the first by clicking the row itself
		act(() => rows[1]!.querySelector<HTMLElement>('.reaction-toggle')!.click())
		act(() => rows[0]!.querySelector<HTMLElement>('.reaction-body')!.click())
		const toggles = rows.map(
			(r) => r.querySelector('.reaction-toggle')!.textContent,
		)
		expect(toggles).toEqual(['✓ 2', '✓ 1'])
		expect(use.disabled).toBe(false)
		expect(use.textContent).toBe('Use selected (2)')

		act(() => rows[1]!.querySelector<HTMLElement>('.reaction-toggle')!.click())
		expect(rows[0]!.querySelector('.reaction-toggle')!.textContent).toBe('✓ 1')
		expect(rows[1]!.classList.contains('reaction-picked')).toBe(false)
		act(() => root.unmount())
	})

	it('a single reaction: no pick numbers, Skip instead of Skip all', () => {
		const { host, root } = renderWindow({ reactions: 1, named: true })
		const row = host.querySelector<HTMLElement>('.reaction-row')!
		act(() => row.querySelector<HTMLElement>('.reaction-toggle')!.click())
		expect(row.querySelector('.reaction-toggle')!.textContent).toBe('✓')
		expect(buttons(host, /^Skip$/)).toHaveLength(1)
		act(() => root.unmount())
	})

	it('shows a face-down triggering card face up when the choice names it', () => {
		const { host, root } = renderWindow({ reactions: 1, named: true })
		const face = host.querySelector('.source-card .card')!
		expect(face.classList.contains('card-hidden')).toBe(false)
		expect(face.className).toMatch(/card-suit-/)
		act(() => root.unmount())
	})

	it('leaves out a face-down triggering card nothing names', () => {
		const { host, root } = renderWindow({ reactions: 1, named: false })
		expect(host.querySelector('.source-card')).toBeNull()
		expect(host.textContent).not.toContain('??')
		act(() => root.unmount())
	})
})
