// Bot layer (docs/architecture.md §6, todo/15). `cadet` is the Cadet Training
// virtual-opponent interceptor (rules/10, todo/15 §1). The rest is the house
// AI (todo/15 §4) — NOT the official solo Bot, which needs the separate solo
// rulebook (docs/open-questions.md Blocker B2):
//
//   makeBot('first-legal')  the deterministic fuzz driver's choices
//   makeBot('easy')         the heuristic with softmax noise
//   makeBot('normal')       the heuristic (src/bot/heuristic.ts)
//   makeBot('hard')         the ISMCTS search (src/bot/ismcts.ts, docs/bot.md):
//                           HARD_ITERATIONS iterations per decision, or
//                           HARD_TIME_MS of wall clock when given a clock;
//                           its leaf is the learned value
//                           (src/bot/weights/value.json) when the weights are
//                           compatible with `cardData` and passed their gate,
//                           else the hand-tuned evaluation
import type { Bot, BotId } from './types'
import { firstLegalPolicy, nextAutoIntent } from './autoPlay'
import { makeHeuristicBot } from './heuristic'
import { makeIsmctsBot, type IsmctsOptions } from './ismcts'
import type { CardCatalog } from '../engine/setup'
import { BUNDLED_VALUE, hardValue } from './bundledValue'

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
	makeIsmctsBot,
	search as ismctsSearch,
	type IsmctsOptions,
	type IsmctsStats,
} from './ismcts'
export {
	loadValue,
	compatibleValue,
	incompatibility,
	featureHash,
	type ValueWeights,
	type ValueFn,
} from './learned'
export { BUNDLED_VALUE, hardValue, gatePassed } from './bundledValue'
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

/** The Hard level's deterministic budget: ISMCTS iterations per decision
 *  (the arena budget; ~0.15–0.4 s per searched decision on one core). */
export const HARD_ITERATIONS = 200

/** The Hard level's wall-clock budget per decision (ms) when `makeBot` gets
 *  a clock (the UI / a worker passes `performance.now`). */
export const HARD_TIME_MS = 1500

/** Iteration cap under the wall-clock budget (bounds memory on fast
 *  machines and in exhausted single-turn trees). */
export const HARD_MAX_ITERATIONS = 3000

/** The Hard level's search settings (besides the budget). */
export const HARD_OPTIONS: Readonly<IsmctsOptions> = {}

export interface MakeBotOptions {
	/** A wall clock in ms (e.g. `performance.now`). With it the Hard level
	 *  searches for `timeMs` per decision instead of HARD_ITERATIONS. */
	clock?: (() => number) | undefined
	/** The Hard level's time budget with a clock (default HARD_TIME_MS). */
	timeMs?: number | undefined
	/** The card data the bot plays on (the catalog, or its cardDataHash).
	 *  Hard uses the learned value only when given this and the weights were
	 *  trained on the same card data; without it, Hard is hand-tuned. */
	cardData?: CardCatalog | string | undefined
	/** Learned weights to use instead of the bundled value.json (tests);
	 *  null forces the hand-tuned leaf. */
	valueWeights?: unknown
}

/** The bot registry. */
export function makeBot(id: BotId, opts: MakeBotOptions = {}): Bot {
	switch (id) {
		case 'first-legal':
			return firstLegalBot
		case 'easy':
			return makeHeuristicBot({ id: 'easy', noise: EASY_NOISE })
		case 'normal':
			return makeHeuristicBot({ id: 'normal' })
		case 'hard': {
			const value =
				opts.valueWeights === null
					? undefined
					: hardValue(opts.cardData, opts.valueWeights ?? BUNDLED_VALUE)
			return makeIsmctsBot(
				opts.clock === undefined
					? { ...HARD_OPTIONS, id: 'hard', iterations: HARD_ITERATIONS, value }
					: {
							...HARD_OPTIONS,
							id: 'hard',
							iterations: HARD_MAX_ITERATIONS,
							timeMs: opts.timeMs ?? HARD_TIME_MS,
							clock: opts.clock,
							value,
						},
			)
		}
	}
}
