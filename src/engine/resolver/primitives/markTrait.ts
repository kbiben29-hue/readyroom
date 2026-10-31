import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { suspend, answered, answer } from '../runtime'
import { resolveQuery } from '../../queries/resolveQuery'
import { effectiveTraits } from '../../queries/traits'
import { cardDef } from '../../cards'
import { zonesOf, type GameState, type EffectCtx } from '../../state'
import type { TraitId } from '../../../data/ids'

type Node = Extract<Effect, { k: 'MARK_TRAIT' }>

/** The marked entries of a seat's trait-marking board (2KHA). */
export function markedTraits(state: GameState, seat: 0 | 1): string[] {
	return state.players[seat].markedTraits ?? []
}

/** Traits of the opponent's CAPTAIN usable for the board's opponent entries:
 *  non-HUMAN if possible (the 2KHA crew rules). */
function opponentCaptainTraits(state: GameState, seat: 0 | 1): TraitId[] {
	const other = (1 - seat) as 0 | 1
	const cap = zonesOf(state, { k: 'CAPTAIN', seat: other })[0]
	if (cap === undefined) return []
	const traits = cardDef(state.cards[cap]!.def).traits.filter((t) => t !== 'ATTACK')
	const nonHuman = traits.filter((t) => t !== 'HUMAN')
	// two entries, each a different trait: non-HUMAN ones when there are two
	return nonHuman.length >= 2 ? nonHuman : traits
}

/** The traits this mark could record, with where each would go. */
function options(state: GameState, node: Node, ctx: EffectCtx): TraitId[] {
	const seat = ctx.actor
	const marked = markedTraits(state, seat)
	let offered: TraitId[]
	if (node.from === 'ANY') {
		offered = [...node.traits, ...opponentCaptainTraits(state, seat)]
	} else {
		const cards = resolveQuery(state, node.from, ctx)
		const set = new Set<TraitId>()
		for (const iid of cards) {
			const traits = effectiveTraits(state, iid)
			if (traits.includes('WILDCARD')) {
				for (const t of node.traits) set.add(t)
				for (const t of opponentCaptainTraits(state, seat)) set.add(t)
			}
			for (const t of traits) set.add(t)
		}
		offered = [...set]
	}
	const oppUsed = marked.filter((m) => m.startsWith('OPP:')).map((m) => m.slice(4))
	const oppTraits = opponentCaptainTraits(state, seat)
	const out = new Set<TraitId>()
	for (const t of offered) {
		if (node.traits.includes(t) && !marked.includes(t)) out.add(t)
		else if (
			oppTraits.includes(t) &&
			oppUsed.length < node.opponentCaptain &&
			!oppUsed.includes(t)
		)
			out.add(t)
	}
	return [...out]
}

/** MARK_TRAIT (2KHA): mark one trait of a card (or `ANY` trait) on the seat's
 *  trait-marking board: one of `traits` not yet marked, or — up to
 *  `opponentCaptain` entries, each a different trait — a trait of the
 *  opponent's CAPTAIN. A board trait goes on its own entry first. */
export const markTrait: Primitive<Node> = {
	isCost: false,
	canResolve(state, node, ctx) {
		return options(state, node, ctx).length > 0
	},
	execute(state, node, ctx, _frame) {
		const key = 'markTrait.trait'
		const opts = options(state, node, ctx)
		if (opts.length === 0) return state
		if (opts.length > 1 && !answered(ctx, key))
			return suspend(state, node, ctx, key, {
				k: 'CHOOSE_TRAIT',
				traits: opts,
				prompt: 'Mark which trait?',
			})
		const trait = opts.length > 1 ? answer<TraitId>(ctx, key) : opts[0]!
		const marked = markedTraits(state, ctx.actor)
		const entry =
			node.traits.includes(trait) && !marked.includes(trait)
				? trait
				: `OPP:${trait}`
		const players = state.players.map((p) =>
			p.seat === ctx.actor ? { ...p, markedTraits: [...marked, entry] } : p,
		) as typeof state.players
		return { ...state, players }
	},
}
