// Probe mode (docs/state-machine.md §5, todo/04 §11): dry-run a node against a
// cloned state to answer "would this resolve?". Used by `canPlay` later.
// Any PendingChoice resolves to "is there at least one legal selection?" via
// probeFirstChoice; events/reactions are suppressed (emit() no-ops under
// `state.probe`); depth is capped. The real state is never touched —
// forkState (a stack-only deep copy) is enough because the engine is
// copy-on-write everywhere else.

import type { Effect } from './nodes'
import type { GameState, EffectCtx } from '../state'
import { forkState } from '../state'
import { pushEffect, executeOne } from './stack'
import { probeFirstChoice } from './choices'

const PROBE_MAX_STEPS = 2_000

export function probe(state: GameState, node: Effect, ctx: EffectCtx): boolean {
	// forkState deep-copies only the stack, the one place the engine writes in
	// place (ctx.bindings); everything else is copy-on-write (state.ts).
	const clone: GameState = { ...forkState(state), probe: true }
	// The probe must not touch the caller's ctx either: suspend() writes the
	// `key → choiceId` binding in place on the ctx it is handed, so a caller
	// that reuses one ctx object across probes (as the resolver unit tests do)
	// would accumulate stale choices that change later probes' answers. Run the
	// probe against a private copy — the bindings it accumulates live here only.
	const probeCtx: EffectCtx = { ...ctx, bindings: { ...ctx.bindings } }
	let s = pushEffect(clone, node, probeCtx)
	let steps = 0
	while (s.pendingChoice !== null || s.stack.length > 0) {
		if (s.result !== null) break
		if (++steps > PROBE_MAX_STEPS) return false
		try {
			if (s.pendingChoice !== null) {
				s = probeFirstChoice(s)
			} else {
				s = executeOne(s)
			}
		} catch {
			return false
		}
	}
	// failOperation records a FAILED log entry under probe — that's the signal.
	return !s.log.some((e) => e.kind === 'FAILED')
}
