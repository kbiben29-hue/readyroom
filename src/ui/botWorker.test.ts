// The bot worker's message handler (src/ui/botWorker.ts), driven directly:
// it registers the catalogue itself and answers a real Normal-bot decision on
// a real game state with an intent the engine accepts.

import { describe, expect, it, vi } from 'vitest'
import { firstLegalPolicy, nextAutoIntent } from '../bot/autoPlay'
import { legalIntents, reduce } from '../engine/intents'
import { validateChoice } from '../engine/resolver/choices'
import { setup, type SetupConfig } from '../engine/setup'
import type { GameState } from '../engine/state'
import { decisionSeat } from '../session/interrupts'
import { loadBrowserCatalog } from './browserCatalog'

const config: SetupConfig = {
	mode: 'TWO_PLAYER',
	players: [
		{ deck: 'PIC', boardSide: 'BASIC' },
		{ deck: 'SHR', boardSide: 'BASIC' },
	],
	seed: 4242,
	startingSeat: 0,
}

/** A state a few first-legal steps into turn 1, where the bot has a real
 *  choice among several legal intents. */
function midTurnState(): GameState {
	let state = setup(config, loadBrowserCatalog())
	for (let i = 0; i < 200; i++) {
		const legal = legalIntents(state)
		if (state.pendingChoice === null && legal.length > 2) return state
		state = reduce(state, nextAutoIntent(state, legal, firstLegalPolicy)!).state
	}
	throw new Error('never reached a multi-option decision')
}

describe('handleBotRequest', () => {
	it('answers a real Normal decision with a legal intent', async () => {
		const state = midTurnState()
		// a fresh module graph, like the worker's own: its engine card registry
		// starts empty, so the handler must register the catalogue itself
		vi.resetModules()
		const { handleBotRequest } = await import('./botWorker')
		const cards = await import('../engine/cards')
		expect(
			cards.hasCardDef(state.cards[Object.keys(state.cards)[0]!]!.def),
		).toBe(false)
		const legal = legalIntents(state)
		const seat = decisionSeat(state)!
		// structured-clone the payload, as postMessage would
		const req = structuredClone({
			id: 7,
			state,
			seat,
			legal,
			botId: 'normal' as const,
		})
		const res = handleBotRequest(req)
		expect(res.id).toBe(7)
		if (!('intent' in res)) throw new Error(`worker error: ${res.error}`)
		const intent = res.intent
		if (intent.t === 'RESOLVE_CHOICE')
			expect(validateChoice(state, intent.choiceId, intent.selection).ok).toBe(
				true,
			)
		else
			expect(legal.map((l) => JSON.stringify(l))).toContain(
				JSON.stringify(intent),
			)
		// the engine takes it
		expect(() => reduce(state, intent)).not.toThrow()
	})

	it('reports a failure as an error message instead of throwing', async () => {
		const { handleBotRequest } = await import('./botWorker')
		const res = handleBotRequest({
			id: 3,
			state: {} as GameState,
			seat: 0,
			legal: [],
			botId: 'normal',
		})
		expect(res.id).toBe(3)
		expect('error' in res).toBe(true)
	})
})
