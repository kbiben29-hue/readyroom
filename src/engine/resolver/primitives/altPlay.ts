import type { Effect } from '../nodes'
import type { Primitive } from './index'

/** ALT_PLAY (docs/effect-dsl.md §4 Meta, 1PIC08): a static
 *  PASSIVE declaration, not an effect. The engine reads it off the in-play
 *  card (src/engine/altPlay.ts) and offers the granted operation as an extra
 *  way to play matching hand cards; resolving the node itself does nothing. */
export const altPlay: Primitive<Extract<Effect, { k: 'ALT_PLAY' }>> = {
	isCost: false,
	canResolve: () => true,
	execute: (state) => state,
}
