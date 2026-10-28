// Replay viewer tests (todo/17 §3): the log IS the replay — stepping the
// intent-log cursor renders the state at that prefix via the same project()
// the rest of the UI uses, plus the export/copy affordances.

import { describe, expect, it, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { SetupConfig } from '../engine/setup'
import App from './App'
import { useGameStore } from './store'

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

async function renderInGame(): Promise<HTMLElement> {
	const host = document.createElement('div')
	document.body.appendChild(host)
	const root = createRoot(host)
	act(() => {
		useGameStore.getState().loadCatalog()
		useGameStore.getState().startGame(config())
	})
	await act(async () => {
		root.render(<App />)
		await Promise.resolve()
	})
	return host
}

beforeEach(() => {
	document.body.innerHTML = ''
	useGameStore.getState().newGame()
})

describe('replay viewer', () => {
	it('opens from the top bar and renders the latest state + intent log', async () => {
		const host = await renderInGame()
		const replayBtn = [...host.querySelectorAll('button')].find(
			(b) => b.textContent?.trim() === 'Replay',
		)
		expect(replayBtn).toBeDefined()

		act(() => replayBtn!.click())

		const text = host.textContent ?? ''
		expect(text).toContain('Replay —')
		expect(text).toContain('Intent log')
		expect(text).toContain('Start the game') // the one committed intent (START)
		expect(text).toContain('Turn 1') // latest-state header
		expect(text).toContain('Export .json')
		expect(text).toContain('Copy session')
		expect(host.querySelector('.replay-modal')).not.toBeNull()
	})

	it('steps back to SETUP then forward again without leaving the game', async () => {
		const host = await renderInGame()
		act(() =>
			[...host.querySelectorAll('button')]
				.find((b) => b.textContent?.trim() === 'Replay')!
				.click(),
		)

		const startBtn = [...host.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('⏮'),
		)
		expect(startBtn).toBeDefined()
		act(() => startBtn!.click())
		// Cursor 0 = the pre-START SETUP session — no intents applied yet.
		expect(host.textContent ?? '').toContain('0 / 1 intent applied')

		const latestBtn = [...host.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('⏭'),
		)
		act(() => latestBtn!.click())
		expect(host.textContent ?? '').toContain('Latest state')
		// The live game is untouched by replay browsing.
		expect(useGameStore.getState().state?.phase.k).toBe('ACTION')
	})

	it('Sync to server PUTs the session JSON and reports success', async () => {
		const originalFetch = globalThis.fetch
		const calls: Array<{ url: string; init: RequestInit }> = []
		const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input)
			calls.push({ url, init: init ?? {} })
			if (
				String(init?.method).toUpperCase() === 'PUT' &&
				url.includes('/sessions/')
			) {
				return new Response(
					JSON.stringify({ ok: true, id: url.split('/').pop() }),
					{ status: 200 },
				)
			}
			return new Response(JSON.stringify({ ok: false }), { status: 500 })
		}) as typeof fetch
		globalThis.fetch = fetchImpl
		localStorage.removeItem('ready-room:sync-url')
		try {
			const host = await renderInGame()
			act(() =>
				[...host.querySelectorAll('button')]
					.find((b) => b.textContent?.trim() === 'Replay')!
					.click(),
			)

			expect(host.textContent).toContain('Sync to server')
			const btn = [...host.querySelectorAll('button')].find(
				(b) => b.textContent?.trim() === 'Sync to server',
			)
			act(() => btn!.click())
			await act(async () => {
				await new Promise((r) => setTimeout(r, 0))
			})

			expect(host.textContent).toContain('Synced ✓')
			expect(calls).toHaveLength(1)
			expect(calls[0]!.url).toContain('/sessions/')
			const id = calls[0]!.url.split('/').pop()
			const body = JSON.parse(String(calls[0]!.init.body))
			expect(body.id).toBe(id)
			expect(Array.isArray(body.log)).toBe(true)
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	it('Sync to server surfaces a backend failure inline', async () => {
		const originalFetch = globalThis.fetch
		const fetchImpl = (async () =>
			new Response(JSON.stringify({ ok: false, error: 'boom' }), {
				status: 500,
			})) as typeof fetch
		globalThis.fetch = fetchImpl
		try {
			const host = await renderInGame()
			act(() =>
				[...host.querySelectorAll('button')]
					.find((b) => b.textContent?.trim() === 'Replay')!
					.click(),
			)
			const btn = [...host.querySelectorAll('button')].find(
				(b) => b.textContent?.trim() === 'Sync to server',
			)
			act(() => btn!.click())
			await act(async () => {
				await new Promise((r) => setTimeout(r, 0))
			})
			expect(host.textContent).toContain('session backend /sessions/')
			expect(host.textContent).toContain('HTTP 500')
			expect(host.textContent).not.toContain('Synced ✓')
		} finally {
			globalThis.fetch = originalFetch
		}
	})
})
