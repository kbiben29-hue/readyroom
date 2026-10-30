// Load-screen tests (todo/17 §1/§3): the setup screen browses saved sessions
// (meta-driven, no replay), Continue resumes into the game, a card-data drift
// labels a save instead of silently replaying wrong, Delete removes it, and
// the import path parses a picked file.

import { describe, expect, it, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { SetupConfig } from '../engine/setup'
import { createSession, type Session } from '../session/log'
import App from './App'
import { useGameStore } from './store'
import {
	cardDataDrift,
	exportSession,
	getSessionStore,
	readSessionFile,
	resetSessionStoreForTests,
} from './persistence'
import { loadBrowserCatalog } from './browserCatalog'
import { endedLine } from './load'

const catalog = loadBrowserCatalog()

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

async function seedSave(mutate?: (s: Session) => Session): Promise<Session> {
	let session = createSession(config(), catalog, { id: 'load-test' })
	if (mutate !== undefined) session = mutate(session)
	await getSessionStore().save(session)
	return session
}

async function renderApp(): Promise<HTMLElement> {
	const host = document.createElement('div')
	document.body.appendChild(host)
	const root = createRoot(host)
	await act(async () => {
		root.render(<App />)
		for (let i = 0; i < 10; i++) await Promise.resolve()
	})
	return host
}

async function flush(inside: () => void): Promise<void> {
	await act(async () => {
		inside()
		for (let i = 0; i < 10; i++) await Promise.resolve()
	})
}

beforeEach(() => {
	document.body.innerHTML = ''
	resetSessionStoreForTests()
	useGameStore.getState().newGame()
})

describe('saved-games load screen', () => {
	it('lists a saved game (meta only) with Continue; Continue resumes', async () => {
		const session = await seedSave()
		act(() => useGameStore.getState().loadCatalog())
		const host = await renderApp()

		const text = host.textContent ?? ''
		expect(text).toContain('Continue a saved game')
		// Deck names come from the captain cards — assert the row + buttons.
		expect(host.querySelectorAll('.save-row')).toHaveLength(1)
		expect(host.querySelector('.save-row')?.textContent).toContain('Continue')
		expect(host.querySelector('.save-row')?.textContent).toContain('score est.')

		const store = useGameStore.getState()
		expect(store.state).toBeNull() // still on the setup screen

		const continueBtn = [...host.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Continue'),
		)
		expect(continueBtn).toBeDefined()
		await flush(() => continueBtn!.click())

		expect(useGameStore.getState().state).not.toBeNull()
		expect(useGameStore.getState().session?.id).toBe(session.id)
	})

	it('labels a save whose card data drifted, and still lets you continue (with a warning)', async () => {
		await seedSave((s) => ({
			...s,
			meta: { ...s.meta, cardDataHash: 'deadbeefdeadbeef' },
		}))
		act(() => useGameStore.getState().loadCatalog())
		const host = await renderApp()

		const matches = host.querySelectorAll('.save-row')
		expect(matches).toHaveLength(1)
		expect(matches[0]!.textContent).toContain('card data changed')
		expect(host.querySelector('.save-warn-badge')).not.toBeNull()

		const continueBtn = [...host.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Continue'),
		)
		await flush(() => continueBtn!.click())
		expect(useGameStore.getState().warning).not.toBeNull()
	})

	it('shows a finished game as ended, with its result and View result', async () => {
		await seedSave((s) => ({
			...s,
			opponents: { 1: 'easy' },
			meta: {
				...s.meta,
				phase: 'GAME_OVER',
				result: 'COMPLETE',
				turnNumber: 21,
				final: { score: [43, 20], winners: [0] },
			},
		}))
		act(() => useGameStore.getState().loadCatalog())
		const host = await renderApp()

		const row = host.querySelector('.save-row.save-ended')
		expect(row).not.toBeNull()
		const text = row!.textContent ?? ''
		expect(text).toContain('ended on turn 21')
		expect(text).toContain('Game over · You won · 43–20')
		expect(text).toContain('View result')
		expect(text).not.toContain('score est.')
		expect(text).not.toContain('awaiting')
	})

	it('Delete removes the save from the list and from storage', async () => {
		await seedSave()
		act(() => useGameStore.getState().loadCatalog())
		const host = await renderApp()
		expect(host.querySelectorAll('.save-row')).toHaveLength(1)

		const del = [...host.querySelectorAll('button')].find((b) =>
			b.getAttribute('aria-label')?.includes('delete save'),
		)
		expect(del).toBeDefined()
		await flush(() => del!.click())
		expect(host.querySelectorAll('.save-row')).toHaveLength(0)
		expect(await getSessionStore().list()).toHaveLength(0)
	})
})

describe('endedLine', () => {
	const ended = (
		final: Session['meta']['final'],
		extra: Partial<Session> = {},
	): Session => {
		const s = createSession(config(), catalog, { id: 'ended' })
		return {
			...s,
			...extra,
			meta: { ...s.meta, result: 'COMPLETE', final },
		}
	}

	it('names the winner: You, the House AI, or the captain in hot-seat', () => {
		const vsAi = { opponents: { 1: 'easy' as const } }
		expect(endedLine(ended({ score: [43, 20], winners: [0] }, vsAi))).toBe(
			'Game over · You won · 43–20',
		)
		expect(endedLine(ended({ score: [20, 43], winners: [1] }, vsAi))).toBe(
			'Game over · House AI (Easy) won · 20–43',
		)
		const hotSeat = ended({ score: [30, 41], winners: [1] })
		expect(endedLine(hotSeat)).toBe(
			`Game over · ${hotSeat.meta.deckNames[1]} won · 30–41`,
		)
	})

	it('a tie, a Cadet result, and an old save without the result', () => {
		expect(endedLine(ended({ score: [33, 33], winners: [0, 1] }))).toBe(
			'Game over · tie · 33–33',
		)
		const cadet = { setup: { ...config(), mode: 'CADET' as const } }
		expect(endedLine(ended({ score: [85, 0], winners: [0] }, cadet))).toBe(
			'Game over · 85 VP',
		)
		expect(endedLine(ended({ score: [85, 0], winners: [] }, cadet))).toBe(
			'Game over · lost to the Burn',
		)
		expect(endedLine(ended(undefined))).toBe('Game over')
	})
})

describe('drift + import helpers', () => {
	it('cardDataDrift flags a stored hash that no longer matches the catalog', async () => {
		const clean = createSession(config(), catalog)
		expect(cardDataDrift(clean, catalog).ok).toBe(true)
		const dirty = {
			...clean,
			meta: { ...clean.meta, cardDataHash: '0'.repeat(16) },
		}
		expect(cardDataDrift(dirty, catalog).ok).toBe(false)
	})

	it('imports a .session.json file into a resumable session', async () => {
		const session = createSession(config(), catalog)
		const file = new File([exportSession(session)], 'x.json', {
			type: 'application/json',
		})
		const parsed = await readSessionFile(file)
		expect(parsed.id).toBe(session.id)
	})
})
