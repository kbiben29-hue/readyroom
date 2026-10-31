import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { pickSingle, setOwner, emit } from '../runtime'
import { matchFilter } from '../../queries/resolveQuery'
import { moveCard, zonesOf, type GameState } from '../../state'
import { shuffle } from '../../rng'
import type { CardInstanceId } from '../../ids'

type Node = Extract<Effect, { k: 'TAKE_REWARD' }>

function pile(state: GameState, node: Node): CardInstanceId[] {
	return zonesOf(state, { k: 'REWARD_PILE' }).filter(
		(iid) =>
			node.filter === undefined ||
			matchFilter(state, state.cards[iid]!, node.filter, {
				allowWildcard: false,
				actorMayOptIn: false,
			}),
	)
}

/** TAKE_REWARD (Second Contact, 3LOC01): look at `look` random cards
 *  from the Reward pile, take one into your hand and destroy the others.
 *  The random pick is drawn once and kept in the frame's bindings so the
 *  choice resumes on the same cards. */
export const takeReward: Primitive<Node> = {
	isCost: false,
	canResolve(state, node) {
		return pile(state, node).length > 0
	},
	execute(state, node, ctx, _frame) {
		let s = state
		let looked = ctx.bindings['$reward.looked'] as CardInstanceId[] | undefined
		if (looked === undefined) {
			const [order, rng] = shuffle(pile(s, node), s.rng)
			s = { ...s, rng }
			looked = order.slice(0, node.look)
			ctx.bindings['$reward.looked'] = looked
		}
		if (looked.length === 0) return s
		const r = pickSingle(s, node, ctx, 'takeReward', {
			prompt: 'Take which Reward card?',
			candidates: looked,
			from: 'REWARD_PILE',
		})
		if (r.kind === 'suspended') return r.state
		if (r.kind === 'none') return s
		const taken = r.iids[0]!
		s = setOwner(s, taken, ctx.actor)
		s = moveCard(s, taken, { k: 'HAND', seat: ctx.actor })
		for (const iid of looked)
			if (iid !== taken)
				s = emit(moveCard(s, iid, { k: 'BOX' }), {
					k: 'CARD_DESTROYED',
					iid,
					seat: ctx.actor,
				})
		delete ctx.bindings['$reward.looked']
		return s
	},
}
