// The one place the bot worker (src/ui/botWorker.ts) builds its bots. A
// worker is the right home for anything that needs a wall clock: src/bot is
// held to the determinism lint (no Date.now / performance.now steering play),
// so a time-budgeted search gets its clock injected from here.

import { makeBot } from '../bot/index'
import type { Bot, BotId } from '../bot/types'
import { explainDecision, type DecisionInfo } from '../bot/explain'
import type { GameState } from '../engine/state'
import type { Intent } from '../engine/intents'
import type { Seat } from '../engine/resolver/queries'

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

/** One explained decision of `bot` (src/bot/explain.ts), timed in ms when
 *  the bot did not time itself. Shared by the worker and the in-thread
 *  runner (kept here so the worker never imports botRunner.ts, which spawns
 *  workers). */
export function runExplained(
	bot: Bot,
	state: GameState,
	seat: Seat,
	legal: Intent[],
): { intent: Intent; info: DecisionInfo } {
	const t0 = performance.now()
	const { intent, info } = explainDecision(bot, state, seat, legal)
	return {
		intent,
		info: { ...info, ms: info.ms ?? Math.round(performance.now() - t0) },
	}
}
