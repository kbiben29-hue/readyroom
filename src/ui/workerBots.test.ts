// @vitest-environment node
// The UI's bots get the card data the learned value checks (src/bot/learned.ts):
// the bundled browser catalogue must hash exactly like the Node loader's, or
// Hard would never use weights trained by tools/train-value.ts.

import { describe, expect, it } from 'vitest'

import { loadCatalog } from '../data/catalog'
import { cardDataHash } from '../data/cardDataHash'
import { createBotForWorker, createBotInThread, uiCatalog } from './workerBots'

describe('workerBots', () => {
	it('the browser catalogue has the same card-data hash as the Node loader', async () => {
		expect(cardDataHash(uiCatalog())).toBe(cardDataHash(await loadCatalog()))
	})

	it('builds every level in the worker and in-thread', () => {
		for (const id of ['first-legal', 'easy', 'normal', 'hard'] as const) {
			expect(createBotForWorker(id).id).toBe(id)
			expect(createBotInThread(id).id).toBe(id)
		}
	})
})
