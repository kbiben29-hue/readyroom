import type { Effect } from '../nodes'
import type { Primitive } from './index'
import { replaceGain as mark } from '../replacement'

/** REPLACE_GAIN (docs/effect-dsl.md §6 "would" windows): "When you would gain
 *  a card, scan N of the same suit instead" (1SIS22, 1BUR06). Only
 *  meaningful under a WOULD_GAIN_CARD trigger (schema-enforced):
 *  the pending GAIN_CARD then resolves as SCAN_N { n, suits: [its suit] }. */
export const replaceGain: Primitive<Extract<Effect, { k: 'REPLACE_GAIN' }>> = {
	isCost: false,
	canResolve: () => true,
	execute: (state, node, ctx) => mark(state, ctx, node.scan),
}
