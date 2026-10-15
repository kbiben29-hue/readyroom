// Duty Officer slots (rules/08 `promote`, rules/03 §3.5.6).
//
// "Duty Officer limit is normally 1. Some effects raise it (outright, or
// conditionally on the extra PERSON's traits). If you ever exceed your limit,
// you must dismiss Duty Officers until you meet it. Otherwise, you may dismiss
// one when promoting a new one."
//
// A seat has `player.dutyOfficerLimit` unrestricted slots plus one slot per
// active `dutyOfficerSlot` modifier (src/engine/modifiers.ts), each optionally
// restricted to a PERSON with one of its traits (1BUR06, 1PER01
// 1PER01). A set of Duty Officers "fits" when every one of them can sit
// in a distinct slot it qualifies for — a tiny bipartite matching (Kuhn).

import type { GameState } from './state'
import { moveCard, player, zoneKey } from './state'
import { cardDef } from './cards'
import type { CardInstanceId } from './ids'
import type { Seat } from './resolver/queries'
import type { TraitId } from '../data/ids'
import { extraDutyOfficerSlots, forbidsAttackCards } from './modifiers'
import { matchTrait } from './queries/traits'

export interface DutyOfficerSlot {
	/** Only a PERSON with any of these traits may fill it; omitted = any. */
	traits?: TraitId[] | undefined
}

/** Every Duty Officer slot `seat` currently has. */
export function dutyOfficerSlots(
	state: GameState,
	seat: Seat,
): DutyOfficerSlot[] {
	const base = player(state, seat).dutyOfficerLimit
	const out: DutyOfficerSlot[] = []
	for (let i = 0; i < base; i++) out.push({})
	return [...out, ...extraDutyOfficerSlots(state, seat)]
}

/** The cards in `seat`'s Duty Officer zone. */
export function dutyOfficers(state: GameState, seat: Seat): CardInstanceId[] {
	return [...(state.zones[zoneKey({ k: 'DUTY_OFFICER', seat })] ?? [])]
}

function qualifies(
	state: GameState,
	iid: CardInstanceId,
	slot: DutyOfficerSlot,
): boolean {
	if (slot.traits === undefined || slot.traits.length === 0) return true
	return slot.traits.some((t) =>
		matchTrait(state, iid, t, { allowWildcard: true, actorMayOptIn: false }),
	)
}

/** Maximum number of `iids` that can be seated in `slots` at once. */
function maxSeated(
	state: GameState,
	iids: CardInstanceId[],
	slots: DutyOfficerSlot[],
): number {
	const slotOf: (number | undefined)[] = slots.map(() => undefined)
	const tryAssign = (i: number, seen: boolean[]): boolean => {
		for (let s = 0; s < slots.length; s++) {
			if (seen[s] === true || !qualifies(state, iids[i]!, slots[s]!)) continue
			seen[s] = true
			const holder = slotOf[s]
			if (holder === undefined || tryAssign(holder, seen)) {
				slotOf[s] = i
				return true
			}
		}
		return false
	}
	let n = 0
	for (let i = 0; i < iids.length; i++) if (tryAssign(i, [])) n++
	return n
}

/** Can all of `iids` be Duty Officers of `seat` at once? */
export function dutyOfficersFit(
	state: GameState,
	seat: Seat,
	iids: CardInstanceId[],
): boolean {
	return maxSeated(state, iids, dutyOfficerSlots(state, seat)) === iids.length
}

/** Promoting `iid`: null when it fits beside the current Duty Officers (no
 *  dismissal needed), else the Duty Officers whose dismissal makes room
 *  (rules/08 "you may dismiss one when promoting a new one" — at the limit
 *  the dismissal is what makes the promotion possible). Empty = cannot fit.
 *  Evaluated on the hypothetical board, so slots granted by the promoted
 *  PERSON itself (1BUR06) count, and slots granted by the
 *  dismissed Duty Officer do not. */
export function promoteDismissOptions(
	state: GameState,
	seat: Seat,
	iid: CardInstanceId,
): CardInstanceId[] | null {
	const current = dutyOfficers(state, seat)
	const after = moveCard(state, iid, { k: 'DUTY_OFFICER', seat })
	if (dutyOfficersFit(after, seat, [...current, iid])) return null
	return current.filter((d) => {
		const without = moveCard(after, d, { k: 'DISCARD', seat })
		return dutyOfficersFit(without, seat, [
			...current.filter((x) => x !== d),
			iid,
		])
	})
}

/** May `iid` be promoted by `seat` at all (card flags + restrictions, not
 *  the slot count)? 1SIS13 "cannot be promoted"; 1PER01 ADMIRAL
 *  1PER01 "you cannot … promote cards with ATTACK". Non-PERSONs never. */
export function promotable(
	state: GameState,
	seat: Seat,
	iid: CardInstanceId,
): boolean {
	const card = state.cards[iid]
	if (card === undefined) return false
	const def = cardDef(card.def)
	if (def.suit !== 'PERSON') return false
	if (def.cannotBePromoted === true) return false
	if (forbidsAttackCards(state, seat) && hasAttack(state, iid)) return false
	if (promoteDismissOptions(state, seat, iid)?.length === 0) return false
	return true
}

/** Does the card print any ATTACK operation ("a card with ATTACK")? */
export function hasAttack(state: GameState, iid: CardInstanceId): boolean {
	const card = state.cards[iid]
	if (card === undefined) return false
	return cardDef(card.def).operations.some((op) => op.isAttack)
}

/** Over the limit (a slot-granting card left play, a threshold dropped):
 *  the Duty Officers whose dismissal moves `seat` toward its limit — those
 *  whose removal leaves no more of the others unseated than before (a
 *  slot-granting Duty Officer takes its slot with it). Empty when everyone
 *  fits. */
export function overflowDismissCandidates(
	state: GameState,
	seat: Seat,
): CardInstanceId[] {
	const current = dutyOfficers(state, seat)
	const unseated = (s: GameState, iids: CardInstanceId[]): number =>
		iids.length - maxSeated(s, iids, dutyOfficerSlots(s, seat))
	const over = unseated(state, current)
	if (over === 0) return []
	const helps = current.filter((d) => {
		const rest = current.filter((x) => x !== d)
		const without = moveCard(state, d, { k: 'DISCARD', seat })
		return unseated(without, rest) < over
	})
	return helps.length > 0 ? helps : current
}
