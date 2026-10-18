// The one place the UI builds its bots, in the bot worker (src/ui/botWorker.ts)
// and in the in-thread fallback (src/ui/botRunner.ts). A worker is the right
// home for anything that needs a wall clock: src/bot is held to the
// determinism lint (no Date.now / performance.now steering play), so a
// time-budgeted search gets its clock injected from here.
//
// Both paths pass the bundled card catalogue as `cardData`, so Hard uses the
// learned value (src/bot/weights/value.json) exactly when those weights were
// trained on this card data and passed their gate (src/bot/bundledValue.ts).

import { makeBot } from '../bot/index'
import type { Bot, BotId } from '../bot/types'
import type { CardCatalog } from '../engine/setup'
import { loadBrowserCatalog } from './browserCatalog'

let catalog: CardCatalog | undefined

/** The bundled card catalogue, loaded once per thread. */
export function uiCatalog(): CardCatalog {
	catalog ??= loadBrowserCatalog()
	return catalog
}

/** The bot `botId` plays with inside the worker (cached per id by the
 *  worker, so this runs once per level per worker lifetime). */
export function createBotForWorker(botId: BotId): Bot {
	// Hard searches for a wall-clock budget (HARD_TIME_MS) rather than a fixed
	// iteration count, so it plays as well as the device allows. Its moves then
	// depend on device speed, which is fine: the session log records the
	// intents, not the bot.
	if (botId === 'hard')
		return makeBot('hard', {
			clock: () => performance.now(),
			cardData: uiCatalog(),
		})
	return makeBot(botId)
}

/** The bot `botId` plays with on the main thread (the fallback when no worker
 *  can start): Hard keeps its deterministic iteration budget there, so a
 *  decision cannot freeze the page for the full time budget. */
export function createBotInThread(botId: BotId): Bot {
	if (botId === 'hard') return makeBot('hard', { cardData: uiCatalog() })
	return makeBot(botId)
}
