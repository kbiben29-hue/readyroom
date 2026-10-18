// The one place the bot worker (src/ui/botWorker.ts) builds its bots. A
// worker is the right home for anything that needs a wall clock: src/bot is
// held to the determinism lint (no Date.now / performance.now steering play),
// so a time-budgeted search gets its clock injected from here.

import { makeBot } from '../bot/index'
import type { Bot, BotId } from '../bot/types'

/** The bot `botId` plays with inside the worker (cached per id by the
 *  worker, so this runs once per level per worker lifetime). */
export function createBotForWorker(botId: BotId): Bot {
	// TODO(house-ai ISMCTS): once the 'hard' factory accepts an injected clock,
	// build it here with a wall-clock budget, e.g.
	//   makeBot('hard', { clock: () => performance.now(), timeMs: 1500 })
	// (performance.now is fine here: src/ui is outside the bot determinism
	// lint, and the worker is the only caller.)
	return makeBot(botId)
}
