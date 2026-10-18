// Bot spec registry (house AI, todo/15 §4): turns a spec string into a Bot,
// so the arena (tools/arena.ts) and later packages can name any opponent on
// the command line.
//
//   'normal'                              a makeBot id
//   'heuristic:samples=4,noise=0.5'       a factory name + `key=value` params
//   'heuristic:w.loc.secured=2'           (heuristic) an EVAL_WEIGHTS override
//
// Registering a new bot is one line:
//
//   BOT_FACTORIES['ismcts'] = (p) => makeIsmctsBot({ iters: num(p, 'iters') })
//
// A factory gets the parsed params (strings) and returns a Bot. Bots are pure
// and stateless, so a factory may return a shared instance.

import type { Bot } from './types'
import { makeBot } from './index'
import { makeHeuristicBot } from './heuristic'
import { FEATURE_NAMES, type FeatureName } from './evaluate'

/** Parsed `key=value` params of a spec (values unparsed). */
export type BotParams = Readonly<Record<string, string>>

/** Builds a Bot from its spec params. */
export type BotFactory = (params: BotParams) => Bot

/** A numeric param, or undefined when absent. Throws on a non-number. */
export function num(params: BotParams, key: string): number | undefined {
	const raw = params[key]
	if (raw === undefined) return undefined
	const v = Number(raw)
	if (!Number.isFinite(v))
		throw new Error(`bot spec: param '${key}' is not a number ('${raw}')`)
	return v
}

/** The factory registry. Keys are spec names. */
export const BOT_FACTORIES: Record<string, BotFactory> = {
	'first-legal': () => makeBot('first-legal'),
	easy: () => makeBot('easy'),
	normal: () => makeBot('normal'),
	hard: () => makeBot('hard'),
	/** The heuristic with explicit options: samples, noise, maxSims,
	 *  maxSettleSteps, horizon=turn|round, missionsFirst=0|1, and `w.<feature>`
	 *  weight overrides (FEATURE_NAMES). */
	heuristic: (p) => {
		const weights: Partial<Record<FeatureName, number>> = {}
		for (const key of Object.keys(p)) {
			if (!key.startsWith('w.')) continue
			const name = key.slice(2) as FeatureName
			if (!(FEATURE_NAMES as readonly string[]).includes(name))
				throw new Error(`bot spec: unknown feature weight '${name}'`)
			weights[name] = num(p, key)!
		}
		const horizon = p['horizon']
		if (horizon !== undefined && horizon !== 'turn' && horizon !== 'round')
			throw new Error(`bot spec: horizon must be turn|round ('${horizon}')`)
		const mf = p['missionsFirst']
		return makeHeuristicBot({
			samples: num(p, 'samples'),
			noise: num(p, 'noise'),
			maxSims: num(p, 'maxSims'),
			maxSettleSteps: num(p, 'maxSettleSteps'),
			horizon,
			missionsFirst:
				mf === undefined ? undefined : mf !== '0' && mf !== 'false',
			weights: Object.keys(weights).length > 0 ? weights : undefined,
		})
	},
}

/** Register (or replace) a bot factory. */
export function registerBot(name: string, factory: BotFactory): void {
	BOT_FACTORIES[name] = factory
}

/** Split a spec into its factory name and params. */
export function parseBotSpec(spec: string): {
	name: string
	params: BotParams
} {
	const colon = spec.indexOf(':')
	const name = (colon < 0 ? spec : spec.slice(0, colon)).trim()
	const params: Record<string, string> = {}
	if (colon >= 0) {
		for (const part of spec.slice(colon + 1).split(',')) {
			if (part.trim() === '') continue
			const eq = part.indexOf('=')
			if (eq < 0)
				throw new Error(`bot spec '${spec}': '${part}' is not key=value`)
			params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
		}
	}
	return { name, params }
}

/** Build the Bot a spec names. Throws on an unknown name. */
export function botFromSpec(spec: string): Bot {
	const { name, params } = parseBotSpec(spec)
	const factory = BOT_FACTORIES[name]
	if (factory === undefined)
		throw new Error(
			`unknown bot '${name}' (known: ${Object.keys(BOT_FACTORIES).join(', ')})`,
		)
	return factory(params)
}
