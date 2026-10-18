// Bot spec registry (house AI, todo/15 §4): turns a spec string into a Bot,
// so the arena (tools/arena.ts) and later packages can name any opponent on
// the command line.
//
//   'normal'                              a makeBot id
//   'heuristic:samples=4,noise=0.5'       a factory name + `key=value` params
//   'heuristic:w.loc.secured=2'           (heuristic) an EVAL_WEIGHTS override
//   'ismcts:iters=100,value=learned'      ISMCTS with the bundled learned value
//   'ismcts:iters=100,value=cand'         … with weights the caller loaded as
//                                         ctx.weights.cand (arena --weights)
//   'learned:iters=100'                   = ismcts with value=learned
//
// Registering a new bot is one line:
//
//   BOT_FACTORIES['mybot'] = (p) => makeMyBot({ depth: num(p, 'depth') })
//
// A factory gets the parsed params (strings) and a BotContext (the card
// catalog, extra learned weights) and returns a Bot. Bots are pure and
// stateless, so a factory may return a shared instance.

import type { Bot } from './types'
import { makeBot } from './index'
import { makeHeuristicBot } from './heuristic'
import {
	makeIsmctsBot,
	type LeafMode,
	type PriorMode,
	type IsmctsOptions,
	type RolloutPolicy,
} from './ismcts'
import { FEATURE_NAMES, type FeatureName } from './evaluate'
import type { CardCatalog } from '../engine/setup'
import { incompatibility, loadValue, type ValueFn } from './learned'
import { BUNDLED_VALUE } from './bundledValue'

/** Parsed `key=value` params of a spec (values unparsed). */
export type BotParams = Readonly<Record<string, string>>

/** What a factory may need besides its params. */
export interface BotContext {
	/** The card catalog the bot plays on (the learned value checks its
	 *  card-data hash; `hard` uses the learned value only with it). */
	catalog?: CardCatalog | undefined
	/** Learned weights by name, for `value=<name>` (tools/arena.ts --weights). */
	weights?: Readonly<Record<string, unknown>> | undefined
}

/** Builds a Bot from its spec params. */
export type BotFactory = (params: BotParams, ctx: BotContext) => Bot

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
	/** The Hard level as the app builds it: learned leaf only when the bundled
	 *  weights are compatible with ctx.catalog and passed their gate. */
	hard: (_p, ctx) => makeBot('hard', { cardData: ctx.catalog }),
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
	/** The ISMCTS search (src/bot/ismcts.ts): iters, timeMs (wall clock via
	 *  performance.now — arena results then depend on the machine), c, widen,
	 *  widenK, leaf=settle|rollout, rolloutDepth, rollout=cheap|greedy, prior / rootPrior =
	 *  bonus|step|settle, temp, worlds, turns, maxDepth, scale,
	 *  missionsFirst=0|1, value=eval|learned|<ctx.weights name> (the leaf
	 *  value; default eval = the hand-tuned evaluation), mix=<0..1> (override
	 *  the weights' evalMix: the hand-tuned share of a learned value). */
	ismcts: (p, ctx) =>
		makeIsmctsBot({ ...ismctsOptions(p), value: valueParam(p, ctx) }),
	/** ISMCTS with the bundled learned value (value=learned unless given),
	 *  whether or not its gate passed; throws if the weights are incompatible. */
	learned: (p, ctx) =>
		makeIsmctsBot({
			...ismctsOptions(p),
			value: valueParam({ ...p, value: p['value'] ?? 'learned' }, ctx),
		}),
}

/** The `value` param: undefined for `eval` (or absent), else the learned value
 *  of the named weights (`learned` = the bundled value.json unless
 *  ctx.weights overrides it). Throws when the weights are unknown or do not
 *  match the features or ctx.catalog's card data. */
export function valueParam(p: BotParams, ctx: BotContext): ValueFn | undefined {
	const v = p['value']
	if (v === undefined || v === 'eval') return undefined
	const weights =
		ctx.weights?.[v] ?? (v === 'learned' ? BUNDLED_VALUE : undefined)
	if (weights === undefined)
		throw new Error(
			`bot spec: unknown value '${v}' (eval | learned | a --weights name)`,
		)
	if (ctx.catalog === undefined)
		throw new Error(`bot spec: value=${v} needs the card catalog`)
	const problem = incompatibility(weights, ctx.catalog)
	if (problem !== null)
		throw new Error(`bot spec: value=${v} cannot be used: ${problem}`)
	const mix = num(p, 'mix')
	if (mix !== undefined && !(mix >= 0 && mix <= 1))
		throw new Error(`bot spec: mix must be in [0, 1] ('${mix}')`)
	const w = weights as Parameters<typeof loadValue>[0]
	return loadValue(mix === undefined ? w : { ...w, evalMix: mix })
}

const PRIOR_MODES: readonly PriorMode[] = ['bonus', 'step', 'settle']

function priorMode(p: BotParams, key: string): PriorMode | undefined {
	const v = p[key]
	if (v === undefined) return undefined
	if (!(PRIOR_MODES as readonly string[]).includes(v))
		throw new Error(`bot spec: ${key} must be bonus|step|settle ('${v}')`)
	return v as PriorMode
}

function rolloutPolicy(p: BotParams): RolloutPolicy | undefined {
	const v = p['rollout']
	if (v === undefined) return undefined
	if (v !== 'cheap' && v !== 'greedy')
		throw new Error(`bot spec: rollout must be cheap|greedy ('${v}')`)
	return v
}

/** IsmctsOptions from spec params (see BOT_FACTORIES.ismcts). */
export function ismctsOptions(p: BotParams): IsmctsOptions {
	const leaf = p['leaf']
	if (leaf !== undefined && leaf !== 'settle' && leaf !== 'rollout')
		throw new Error(`bot spec: leaf must be settle|rollout ('${leaf}')`)
	const timeMs = num(p, 'timeMs')
	const mf = p['missionsFirst']
	return {
		iterations: num(p, 'iters'),
		timeMs,
		clock: timeMs === undefined ? undefined : () => performance.now(),
		c: num(p, 'c'),
		widen: num(p, 'widen'),
		widenK: num(p, 'widenK'),
		leaf: leaf as LeafMode | undefined,
		rolloutDepth: num(p, 'rolloutDepth'),
		rollout: rolloutPolicy(p),
		prior: priorMode(p, 'prior'),
		rootPrior: priorMode(p, 'rootPrior'),
		temperature: num(p, 'temp'),
		worlds: num(p, 'worlds'),
		turns: num(p, 'turns'),
		maxDepth: num(p, 'maxDepth'),
		scale: num(p, 'scale'),
		missionsFirst: mf === undefined ? undefined : mf !== '0' && mf !== 'false',
	}
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
export function botFromSpec(spec: string, ctx: BotContext = {}): Bot {
	const { name, params } = parseBotSpec(spec)
	const factory = BOT_FACTORIES[name]
	if (factory === undefined)
		throw new Error(
			`unknown bot '${name}' (known: ${Object.keys(BOT_FACTORIES).join(', ')})`,
		)
	return factory(params, ctx)
}
