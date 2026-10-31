import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { gainResource, pickSingle } from '../runtime'
import { evalAmount, resolveQuery } from '../../queries/resolveQuery'
import type { GameState, EffectCtx } from '../../state'
import type { CardInstanceId } from '../../ids'
import type { ResourceId } from '../../../data/ids'

const ORDER: ResourceId[] = ['DIL', 'LAT', 'GLO']

function total(state: GameState, iid: CardInstanceId): number {
	const t = state.cards[iid]?.resourceTokens ?? {}
	return ORDER.reduce((n, r) => n + (t[r] ?? 0), 0)
}

function candidates(
	state: GameState,
	node: Extract<Effect, { k: 'TAKE_TOKENS' }>,
	ctx: EffectCtx,
): CardInstanceId[] {
	return resolveQuery(state, node.target, ctx).filter((i) => total(state, i) > 0)
}

/** TAKE_TOKENS: gain the resource tokens sitting on a card ("gain all
 *  resources from Earth" — 2ARC04; "gain 3 resources from Earth", `max` 3 —
 *  2ARC01). With `max`, {DIL} goes first, then {LAT}, then {GLO}. */
export const takeTokens: Primitive<Extract<Effect, { k: 'TAKE_TOKENS' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return candidates(state, node, ctx).length > 0
	},
	execute(state, node, ctx, _frame) {
		const r = pickSingle(state, node, ctx, 'takeTokens', {
			prompt: 'Gain the resources from which card?',
			candidates: candidates(state, node, ctx),
			from: 'TOKENS',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return state
		const iid = r.iids[0]!
		let left =
			node.max === undefined ? Infinity : evalAmount(state, node.max, ctx)
		const card = state.cards[iid]!
		const tokens = { ...card.resourceTokens }
		const gained: [ResourceId, number][] = []
		for (const res of ORDER) {
			const have = tokens[res] ?? 0
			const take = Math.min(have, left)
			if (take <= 0) continue
			tokens[res] = have - take
			left -= take
			gained.push([res, take])
		}
		let next: GameState = {
			...state,
			cards: { ...state.cards, [iid]: { ...card, resourceTokens: tokens } },
		}
		for (const [res, n] of gained)
			next = gainResource(next, ctx.actor, res, n, { via: 'MARKET' })
		return next
	},
}
