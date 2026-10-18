// The one place the bot worker (src/ui/botWorker.ts) builds its bots. A
// worker is the right home for anything that needs a wall clock: src/bot is
// held to the determinism lint (no Date.now / performance.now steering play),
// so a time-budgeted search gets its clock injected from here.

import { makeBot } from '../bot/index'
import type { Bot, BotId } from '../bot/types'

/** The bot `botId` plays with inside the worker (cached per id by the
 *  worker, so this runs once per level per worker lifetime). */
export function createBotForWorker(botId: BotId): Bot {
	// Hard searches for a wall-clock budget (HARD_TIME_MS) rather than a fixed
	// iteration count, so it plays as well as the device allows. Its moves then
	// depend on device speed, which is fine: the session log records the
	// intents, not the bot.
	if (botId === 'hard')
		return makeBot('hard', { clock: () => performance.now() })
	return makeBot(botId)
}
