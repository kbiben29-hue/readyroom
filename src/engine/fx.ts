// Token-movement trail (docs/state-machine.md §fx). The rules never read it:
// it exists so the UI can fly a token from the card that caused a change to
// the pool it landed in (a passive's Dilithium, a cost paid into the card being
// played, a steal from one pool to the other).
//
// The engine events carry no source card and some moves emit none at all
// (steal, the Stardate handoff), so instead of instrumenting every primitive
// the stack diffs the token pools around each EFFECT step — the one place that
// knows `ctx.source` — and appends the net changes here.

import type { GameState, TokenFx, TokenPool } from './state'
import type { CardInstanceId } from './ids'
import type { ResourceId } from '../data/ids'

const RESOURCES: readonly ResourceId[] = ['DIL', 'LAT', 'GLO']

/** Net change of every token pool between two states. Cheap on the common
 *  path: card records are compared by reference before their tokens are read. */
export function poolDiff(
	before: GameState,
	after: GameState,
): TokenFx['changes'] {
	const changes: TokenFx['changes'] = []
	const push = (pool: TokenPool, delta: number) => {
		if (delta !== 0) changes.push({ pool, delta })
	}

	if (before.players !== after.players) {
		for (const seat of [0, 1] as const) {
			const a = before.players[seat]
			const b = after.players[seat]
			if (a === b) continue
			for (const res of RESOURCES)
				push({ k: 'PLAYER', seat, res }, b.resources[res] - a.resources[res])
			push(
				{ k: 'PLAYER', seat, res: 'ACTION' },
				b.actions.available - a.actions.available,
			)
		}
	}

	if (before.cards !== after.cards) {
		for (const [key, b] of Object.entries(after.cards)) {
			const a = before.cards[key]
			if (a === b) continue
			const iid = key as CardInstanceId
			for (const res of RESOURCES)
				push(
					{ k: 'CARD', iid, res },
					(b.resourceTokens[res] ?? 0) - (a?.resourceTokens[res] ?? 0),
				)
			push(
				{ k: 'CARD', iid, res: 'ACTION' },
				b.actionTokens - (a?.actionTokens ?? 0),
			)
		}
	}

	push(
		{ k: 'STARDATE' },
		after.stardates.gloryOnTop - before.stardates.gloryOnTop,
	)
	return changes
}

/** Append `after`'s net token changes since `before`, attributed to `source`.
 *  A no-op when nothing moved or the state is a legality probe. */
export function recordFx(
	before: GameState,
	after: GameState,
	source: CardInstanceId | null,
): GameState {
	if (after.probe === true || before === after) return after
	const changes = poolDiff(before, after)
	if (changes.length === 0) return after
	// Phase-step contexts carry an empty source (phases.ts `phaseCtx`).
	const src = source === '' ? null : source
	return { ...after, fx: [...after.fx, { source: src, changes }] }
}
