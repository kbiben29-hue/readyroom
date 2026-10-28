import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { evalAmount } from '../../queries/resolveQuery'
import { suspend, answered, answer } from '../runtime'
import { gloryNote, wouldDoNothing } from './may'
import { describe } from '../../describe'
import type { EffectCtx } from '../../state'

/** Copy the effect context so each REPEAT iteration gets its own bindings
 *  scope. Control nodes share one `ctx` so that answers stay visible to
 *  sibling steps after a choice resumes (see `suspend`/`storeSelection`), but
 *  a REPEAT is a loop, not a sibling: without a per-iteration scope, a choice
 *  answered in iteration 1 is replayed silently in iterations 2..N — reusing
 *  the destination AND skipping the cost (SET A COURSE paid one discard and
 *  silently placed three away teams). Copying the bindings keeps pre-loop
 *  answers visible while scoping mid-iteration writes to that iteration. */
function iterationCtx(ctx: EffectCtx): EffectCtx {
	return { ...ctx, bindings: { ...ctx.bindings } }
}

/** MAX iterations a single REPEAT may expand to — a malformed card must throw,
 *  not hang or blow the loop cap. */
const MAX_ITERATIONS = 500

/** The CONFIRM key of an UP_TO round (consumed — deleted — on resume). */
const MORE_KEY = 'repeat.more'

/**
 * REPEAT. A fixed `times` expands the body that many times up front.
 *
 * `times: { k: 'UP_TO', max }` ("up to N times: …", "discard up to 3 …") runs
 * ROUND BY ROUND — `frame.ip` is the number of rounds done:
 *   - it stops once `max` rounds ran, or as soon as a round could do nothing
 *     (the MAY test: an unresolvable leaf, an unpayable PAY_THEN, …);
 *   - otherwise it asks (CONFIRM) whether to resolve another round, so the
 *     player may stop early — 0 rounds included, "up to" is a maximum;
 *   - each round runs in its own bindings scope, marked optional (an
 *     unpayable cost ends the round, not the operation).
 * `max` is evaluated each round, so it tracks the board ("any number of
 * your SHIPs").
 */
export const repeat: Primitive<Extract<Effect, { k: 'REPEAT' }>> = {
	isCost: false,
	canResolve(state, node, ctx) {
		const t = evalAmount(state, node.times, ctx)
		if (!Number.isInteger(t) || t < 0) {
			throw new Error(
				`REPEAT: times must be a non-negative integer, got ${t} (malformed card?)`,
			)
		}
		return true
	},
	execute(state, node, ctx, frame) {
		const t = evalAmount(state, node.times, ctx)
		if (!Number.isInteger(t) || t < 0) {
			throw new Error(
				`REPEAT: times must be a non-negative integer, got ${t} (malformed card?)`,
			)
		}
		if (t > MAX_ITERATIONS) {
			throw new Error(
				`REPEAT: ${t} iterations exceeds cap ${MAX_ITERATIONS} (malformed card?)`,
			)
		}
		const times = node.times
		if (typeof times === 'object' && times.k === 'UP_TO') {
			const round = frame.ip
			if (answered(ctx, MORE_KEY)) {
				const more = answer<boolean>(ctx, MORE_KEY)
				delete ctx.bindings[MORE_KEY]
				if (!more) return state
				state.stack.push({ k: 'EFFECT', node, ctx, ip: round + 1 })
				state.stack.push({
					k: 'EFFECT',
					node: node.body,
					ctx: { ...iterationCtx(ctx), optional: true },
					ip: 0,
				})
				return state
			}
			if (round >= t) return state
			if (wouldDoNothing(state, node.body, ctx)) return state
			const body = describe(node.body).trim().replace(/\.$/, '')
			return suspend(
				state,
				node,
				ctx,
				MORE_KEY,
				{
					k: 'CONFIRM',
					prompt:
						(round === 0
							? `${body}? (up to ${t} times)`
							: `${body} again? (${round} of up to ${t} done)`) +
						gloryNote(state, node.body, ctx),
				},
				undefined,
				round,
			)
		}
		for (let i = 0; i < t; i++)
			state.stack.push({
				k: 'EFFECT',
				node: node.body,
				ctx: iterationCtx(ctx),
				ip: 0,
			})
		return state
	},
}
