// Bot layer (docs/architecture.md §6, todo/15). `cadet` is the Cadet Training
// virtual-opponent interceptor (rules/10, todo/15 §1). The rest is the house
// AI (todo/15 §4) — NOT the official solo Bot, which needs the separate solo
// rulebook (docs/open-questions.md Blocker B2):
//
//   makeBot('first-legal')  the deterministic fuzz driver's choices
//   makeBot('easy')         the heuristic with softmax noise
//   makeBot('normal')       the heuristic (src/bot/heuristic.ts)
//   makeBot('hard')         the heuristic with 4 worlds per decision (~2× the
//                           time of normal); reserved for ISMCTS
import type { Bot, BotId } from './types'
import { firstLegalPolicy, nextAutoIntent } from './autoPlay'
import { makeHeuristicBot } from './heuristic'

export * from './cadet'
export * from './types'
export {
	autoPlay,
	playBots,
	firstLegalPolicy,
	nextAutoIntent,
	type AutoPlayResult,
	type PlayBotsResult,
	type PlayBotsOptions,
	type ChoicePolicy,
} from './autoPlay'
export { makeHeuristicBot, PRIORS, type HeuristicOptions } from './heuristic'
export {
	determinize,
	determinizeWith,
	seedFromView,
	hiddenPools,
} from './determinize'
export { candidates, cardValuePrior } from './candidates'
export {
	features,
	evaluate,
	evaluateNormalized,
	FEATURE_NAMES,
	EVAL_WEIGHTS,
} from './evaluate'

/** The first-legal bot: exactly the answer autoPlay's driver would give
 *  (the first-legal policy for choices, the first legal intent with
 *  PASS/END_TURN deferred otherwise). */
export const firstLegalBot: Bot = {
	id: 'first-legal',
	decide(state, _seat, legal) {
		return nextAutoIntent(state, legal, firstLegalPolicy) ?? legal[0]!
	},
}

/** Softmax temperature (VP) of the Easy level. */
export const EASY_NOISE = 1.5

/** The bot registry. */
export function makeBot(id: BotId): Bot {
	switch (id) {
		case 'first-legal':
			return firstLegalBot
		case 'easy':
			return makeHeuristicBot({ id: 'easy', noise: EASY_NOISE })
		case 'normal':
			return makeHeuristicBot({ id: 'normal' })
		case 'hard':
			// until the ISMCTS package lands: normal with less sampling noise
			return makeHeuristicBot({ id: 'hard', samples: 4, maxSims: 80 })
	}
}
