import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { evalAmount } from '../../queries/resolveQuery'

/** ADD_AWAY_TEAMS: "add N AWAY TEAM from the supply to your CAPTAIN" (2ARC06,
 *  2ARC07 on enlisting). Grows the seat's pool and its total alike, so the
 *  away-team conservation invariant still holds (the total never decreases). */
export const addAwayTeams: Primitive<Extract<Effect, { k: 'ADD_AWAY_TEAMS' }>> =
	{
		isCost: false,
		canResolve: () => true,
		execute(state, node, ctx, _frame) {
			const n = evalAmount(state, node.amount, ctx)
			if (n <= 0) return state
			const players = state.players.map((pl) =>
				pl.seat === ctx.actor
					? {
							...pl,
							awayTeamsInPool: pl.awayTeamsInPool + n,
							awayTeamsTotal: pl.awayTeamsTotal + n,
						}
					: pl,
			) as typeof state.players
			return { ...state, players }
		},
	}
