import type { Effect } from '../nodes'
import type { Primitive } from './index'

/** REVEAL: show a hand (rules/03 §3.8, "reveal"). Informational only — the
 *  resolver does not hide hands, so revealing changes nothing. It exists so
 *  the card text ("Force your opponent to reveal their hand") round-trips
 *  through describe and the operation is a genuine, resolvable step. */
export const reveal: Primitive<Extract<Effect, { k: 'REVEAL' }>> = {
	isCost: false,
	canResolve: () => true,
	execute: (state) => state,
}
