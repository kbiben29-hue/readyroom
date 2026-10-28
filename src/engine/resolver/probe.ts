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
import { isControl, primitiveOf } from './primitives'

const PROBE_MAX_STEPS = 2_000

/** What a dry run saw: whether it resolves (no unpayable cost), how many
 *  benefit leaves (or player choices) would really happen, and the benefits it would skip
 *  (rules/12 §12.1 — skipped silently in play, but worth a warning). */
export interface ProbeOutcome {
	ok: boolean
	benefits: number
	skipped: Effect[]
}

export function probe(state: GameState, node: Effect, ctx: EffectCtx): boolean {
	return probeOutcome(state, node, ctx).ok
}

/** `probe`, also reporting which benefits would happen and which would be
 *  skipped. Choices take their first legal answer; a choice offered at all
 *  counts as a benefit, since another answer may do what the first skips. */
export function probeOutcome(
	state: GameState,
	node: Effect,
	ctx: EffectCtx,
): ProbeOutcome {
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
	let benefits = 0
	const skipped: Effect[] = []
	const failed: ProbeOutcome = { ok: false, benefits, skipped }
	while (s.pendingChoice !== null || s.stack.length > 0) {
		if (s.result !== null) break
		if (++steps > PROBE_MAX_STEPS) return failed
		try {
			if (s.pendingChoice !== null) {
				// a real decision for the player ("you may…", "choose one") is
				// something the operation offers, whatever the first answer skips
				benefits++
				s = probeFirstChoice(s)
			} else {
				// a benefit leaf on top: it either runs or logs SKIPPED (stack.ts)
				const top = s.stack[s.stack.length - 1]
				const leaf =
					top?.k === 'EFFECT' &&
					!isControl(top.node) &&
					!primitiveOf(top.node).isCost
						? top.node
						: null
				const logged = s.log.length
				s = executeOne(s)
				if (leaf !== null) {
					if (s.log.slice(logged).some((e) => e.kind === 'SKIPPED'))
						skipped.push(leaf)
					else benefits++
				}
			}
		} catch {
			return failed
		}
	}
	// failOperation records a FAILED log entry under probe — that's the signal.
	return { ok: !s.log.some((e) => e.kind === 'FAILED'), benefits, skipped }
}
