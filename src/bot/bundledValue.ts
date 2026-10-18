// The learned value bundled with the app (src/bot/weights/value.json, written
// by `npm run bot:retrain` only when its gate passed) and the rule that picks
// the Hard level's leaf value (docs/bot.md "Learned value").

import type { CardCatalog } from '../engine/setup'
import { compatibleValue, type ValueFn, type ValueWeights } from './learned'
import bundled from './weights/value.json'

/** The bundled weights as shipped (untrusted shape: checked on use). */
export const BUNDLED_VALUE: unknown = bundled

/** Whether `weights` record a passed arena gate (`meta.gate.passed`). */
export function gatePassed(weights: unknown): boolean {
	const w = weights as Partial<ValueWeights> | null
	return w?.meta?.gate?.passed === true
}

/**
 * The Hard level's learned leaf value, or undefined for the hand-tuned one.
 * It is used only when all of these hold:
 *   - `cardData` is given (a catalog or its card-data hash) and the weights
 *     were trained on the same card data;
 *   - the weights match this build's features (featureHash) and their shape;
 *   - their arena gate passed.
 * Anything else falls back silently.
 */
export function hardValue(
	cardData: CardCatalog | string | undefined,
	weights: unknown = BUNDLED_VALUE,
): ValueFn | undefined {
	if (cardData === undefined || !gatePassed(weights)) return undefined
	return compatibleValue(weights, cardData) ?? undefined
}
