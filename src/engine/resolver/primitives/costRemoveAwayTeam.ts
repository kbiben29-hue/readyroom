import type { Effect } from '../nodes'
import type { Primitive } from './index'
import {
	costCanResolve,
	failOperation,
	suspend,
	answered,
	answer,
} from '../runtime'
import { resolveQuery } from '../../queries/resolveQuery'
import { isCadetOpponent } from '../../../bot/cadet'
import type { GameState } from '../../state'
import type { CardInstanceId } from '../../ids'

function removeTokens(
	state: GameState,
	loc: CardInstanceId,
	count: number,
	actor: GameState['players'][0]['seat'],
): GameState {
	const at = state.awayTeamsAt[loc] ?? [0, 0]
	const take = Math.min(count, at[actor] ?? 0)
	const at2: [number, number] = [at[0]!, at[1]!]
	at2[actor] = at2[actor]! - take
	const awayTeamsAt = { ...state.awayTeamsAt, [loc]: at2 }
	const players = state.players.map((pl) =>
		pl.seat === actor
			? { ...pl, awayTeamsInPool: pl.awayTeamsInPool + take }
			: pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return { ...state, awayTeamsAt, players }
}

/** Locations already paid from by a `distinct` cost (one token each). */
const USED = 'costRemoveAwayTeam.used'

/** "Remove an AWAY TEAM from 3 different controlled LOCATIONs" (1SHR16): one token from each of `count` different Locations. The
 *  Locations paid so far live in the shared ctx bindings, so each pick after a
 *  resume excludes them; each pick suspends under its own ordinal key. */
function removeDistinct(
	state: GameState,
	node: Extract<Effect, { k: 'COST_REMOVE_AWAY_TEAM' }>,
	ctx: Parameters<Primitive<Effect>['execute']>[2],
): GameState {
	if (isCadetOpponent(state.mode, ctx.actor)) return state
	let next = state
	for (;;) {
		const used = (
			Array.isArray(ctx.bindings[USED]) ? ctx.bindings[USED] : []
		) as CardInstanceId[]
		if (used.length >= node.count) return next
		const key = `costRemoveAwayTeam.distinct:${used.length}`
		let loc: CardInstanceId
		if (answered(ctx, key)) {
			loc = answer<CardInstanceId>(ctx, key)
		} else {
			const locs =
				node.from !== undefined
					? resolveQuery(next, node.from, ctx)
					: (Object.keys(next.awayTeamsAt) as CardInstanceId[])
			const candidates = locs.filter(
				(iid) =>
					!used.includes(iid) && (next.awayTeamsAt[iid]?.[ctx.actor] ?? 0) > 0,
			)
			if (candidates.length === 0)
				return failOperation(
					next,
					'COST_REMOVE_AWAY_TEAM: not enough different Locations',
				)
			if (candidates.length > 1) {
				return suspend(next, node, ctx, key, {
					k: 'CHOOSE_LOCATION',
					prompt: `Remove an Away Team from which location? (${used.length + 1} of ${node.count}, all different)`,
					candidates,
				})
			}
			loc = candidates[0]!
		}
		ctx.bindings[USED] = [...used, loc]
		next = removeTokens(next, loc, 1, ctx.actor)
	}
}

/** The per-step progress marker shared across sequential COST_REMOVE_AWAY_TEAM
 *  steps of one operation's ctx (e.g. 1SHR16's three-step cost). */
const PROGRESS = 'costRemoveAwayTeam.n'

export const costRemoveAwayTeam: Primitive<
	Extract<Effect, { k: 'COST_REMOVE_AWAY_TEAM' }>
> = {
	isCost: true,
	canResolve: (s, n, ctx) => costCanResolve(s, n, ctx),
	execute(state, node, ctx, _frame) {
		if (node.distinct === true) return removeDistinct(state, node, ctx)
		// Sequential COST_REMOVE_AWAY_TEAM steps share one ctx, so a single hard-
		// coded suspend key would re-read the first answer for every later step
		// (rulebook p.22-23 removes from three *different* Locations). Key each
		// step on its ordinal: the progress marker is written only when a step
		// CONSUMES its answer, so each step suspends under a unique loc:N and its
		// resume finds exactly the key it published. A step's first run uses the
		// next free ordinal; step 0 always uses loc:0 (the standalone case).
		const n =
			typeof ctx.bindings[PROGRESS] === 'number'
				? (ctx.bindings[PROGRESS] as number)
				: 0
		const key = `costRemoveAwayTeam.loc:${n}`
		if (answered(ctx, key)) {
			// The virtual cadet's Away Team is pure quantity — nothing is removed.
			if (isCadetOpponent(state.mode, ctx.actor)) {
				ctx.bindings[PROGRESS] = n + 1
				return state
			}
			ctx.bindings[PROGRESS] = n + 1
			return removeTokens(
				state,
				answer<CardInstanceId>(ctx, key),
				node.count,
				ctx.actor,
			)
		}
		const locs =
			node.from !== undefined
				? resolveQuery(state, node.from, ctx)
				: (Object.keys(state.awayTeamsAt) as CardInstanceId[])
		const candidates = locs.filter((iid) => {
			// One virtual Away Team wherever a cost could be paid (rules/10 §10.2 #3).
			if (isCadetOpponent(state.mode, ctx.actor)) return true
			return (state.awayTeamsAt[iid]?.[ctx.actor] ?? 0) > 0
		})
		if (candidates.length === 0)
			return failOperation(state, 'COST_REMOVE_AWAY_TEAM: no tokens to remove')
		if (candidates.length === 1) {
			if (isCadetOpponent(state.mode, ctx.actor)) return state
			return removeTokens(state, candidates[0]!, node.count, ctx.actor)
		}
		return suspend(state, node, ctx, key, {
			k: 'CHOOSE_LOCATION',
			prompt: 'Remove an Away Team from which location?',
			candidates,
		})
	},
}
