// Legality queries (docs/state-machine.md §5, rules/03 §3.5, rules/07 §7.1.2,
// todo/05 §5). These drive the UI — every operation the engine can resolve
// with the player's current resources/tracks/board is legal, everything else
// is reported with a human reason.
//
//   - canPlay: the card must be in `seat`'s hand and at least one of its PLAY
//     operations must be fully resolvable: `requires` passes, the `[action]`
//     cost is payable, and the resolver's probe dry-run of the effect
//     succeeds (docs/state-machine.md §5).
//   - canActivate: same gate for an ACTIVATION operation on an in-play card
//     whose table operations are available (not Staging, not beamed) and which
//     is not exhausted (rules/08 → `exhaust`).
//   - canComplete / completableMissions: mission goals (rules/07 §7.2) via
//     evalPredicate — the goal tree is the rules, so there is no separate
//     duplicate here.

import { cardDef } from '../cards'
import { moveCard, player, zoneProps, type GameState } from '../state'
import { probe, probeOutcome } from '../resolver/probe'
import { describe } from '../describe'
import { evalPredicate } from './resolveQuery'
import type { CardInstanceId } from '../ids'
import type { Seat } from '../resolver/queries'
import type { Operation } from '../resolver/nodes'
import { altPlayGrants, altPlayOperation, type AltPlayRef } from '../altPlay'
import { forbidsAttackCards, meetsRequirement } from '../modifiers'
import { hasAttack } from '../dutyOfficers'

const PLAIN_CTX = (seat: Seat, source: CardInstanceId) => ({
	actor: seat,
	source,
	bindings: {},
})

export interface CanPlayResult {
	ok: boolean
	operations: number[] // indices of PLAY operations currently resolvable
	/** ALT_PLAY grants (1PIC08) whose operation is currently
	 *  resolvable for this card — alternatives to the printed PLAY ops. */
	altPlays: AltPlayRef[]
	reasons: string[]
}

/** May `seat` play `iid` from hand right now? (rules/03 §3.5.4) */
export function canPlay(
	state: GameState,
	seat: Seat,
	iid: CardInstanceId,
): CanPlayResult {
	const reasons: string[] = []
	const operations: number[] = []
	const altPlays: AltPlayRef[] = []
	const card = state.cards[iid]
	if (!card)
		return { ok: false, operations, altPlays, reasons: ['no such card'] }
	if (
		card.owner !== seat ||
		card.zone.k !== 'HAND' ||
		card.zone.seat !== seat
	) {
		return {
			ok: false,
			operations,
			altPlays,
			reasons: ['card is not in your hand'],
		}
	}
	// 1PER01: "You cannot play or promote cards with ATTACK."
	if (forbidsAttackCards(state, seat) && hasAttack(state, iid)) {
		return {
			ok: false,
			operations,
			altPlays,
			reasons: ['you cannot play cards with ATTACK (1PER01)'],
		}
	}
	// Probe as the play will actually run: the card is placed into the Staging
	// Area FIRST (rules/03 §3.5.4), so e.g. "discard a card" cannot count the
	// card being played.
	const staged = moveCard(state, iid, { k: 'STAGING', seat })
	cardDef(card.def).operations.forEach((op, opIndex) => {
		if (op.type !== 'PLAY') return
		if (!operationResolvable(staged, seat, iid, op)) {
			reasons.push(operationBlockReason(state, seat, op))
			return
		}
		operations.push(opIndex)
	})
	for (const ref of altPlayGrants(state, seat, iid)) {
		const op = altPlayOperation(state, ref)
		if (op === null) continue
		if (!operationResolvable(staged, seat, iid, op)) {
			reasons.push(operationBlockReason(state, seat, op))
			continue
		}
		altPlays.push(ref)
	}
	return {
		ok: operations.length > 0 || altPlays.length > 0,
		operations,
		altPlays,
		reasons,
	}
}

/** May `seat` resolve ACTIVATION operation `opIndex` on `iid`? (rules/03
 *  §3.5.5 — table operations need an in-play card that is not in the Staging
 *  Area and not beamed, and an exhausted card cannot activate, rules/08 →
 *  `exhaust`.) */
export function canActivate(
	state: GameState,
	seat: Seat,
	iid: CardInstanceId,
	opIndex: number,
): { ok: boolean; reason?: string } {
	const card = state.cards[iid]
	if (!card) return { ok: false, reason: 'no such card' }
	if (card.owner !== seat) return { ok: false, reason: 'not your card' }
	const props = zoneProps(card.zone)
	if (!props.inPlay) return { ok: false, reason: 'card is not in play' }
	if (!props.tableOps)
		return {
			ok: false,
			reason: 'card has no table operations here (Staging/beamed)',
		}
	if (card.exhausted)
		return { ok: false, reason: 'card is exhausted until Clean-up' }
	const op = cardDef(card.def).operations[opIndex]
	if (!op) return { ok: false, reason: 'no such operation' }
	if (op.type !== 'ACTIVATION')
		return { ok: false, reason: 'operation is not an ACTIVATION' }
	if (!operationResolvable(state, seat, iid, op)) {
		return { ok: false, reason: operationBlockReason(state, seat, op) }
	}
	return { ok: true }
}

export type LegalActionKind = 'PLAY' | 'ACTIVATION'

export interface SingleLegalAction {
	kind: LegalActionKind
	operationIndex: number
}

/** The single legal PLAY or ACTIVATION operation `seat` may run on `iid`
 *  right now. Returns null when there is no legal operation, or more than one
 *  — in the ambiguous case the caller must let the player pick from the card
 *  detail instead of silently choosing (else a UTILIZE-style card would fire
 *  the wrong effect). Used for the double-click fast path in the UI. */
export function singleLegalAction(
	state: GameState,
	seat: Seat,
	iid: CardInstanceId,
): SingleLegalAction | null {
	const card = state.cards[iid]
	if (card === undefined) return null
	const found: SingleLegalAction[] = []
	const play = canPlay(state, seat, iid)
	// An ALT_PLAY grant is a second way to play this card — never pick silently.
	if (play.altPlays.length > 0) return null
	for (const operationIndex of play.operations) {
		// an operation that would do nothing is never run without a look
		if (idleOperationReason(state, seat, iid, operationIndex) !== null)
			return null
		found.push({ kind: 'PLAY', operationIndex })
		if (found.length > 1) return null
	}
	const def = cardDef(card.def)
	def.operations.forEach((op, operationIndex) => {
		if (found.length > 1) return
		if (op.type !== 'ACTIVATION') return
		if (canActivate(state, seat, iid, operationIndex).ok) {
			found.push({ kind: 'ACTIVATION', operationIndex })
		}
	})
	if (found.length !== 1) return null
	const only = found[0]!
	if (
		only.kind === 'ACTIVATION' &&
		idleOperationReason(state, seat, iid, only.operationIndex) !== null
	)
		return null
	return only
}

/** Why a legal PLAY or ACTIVATION operation would do nothing right now, or
 *  null when it does something. The rules let you resolve it — the costs are
 *  payable and a useless benefit is simply dropped (rules/12 §12.1–12.2) — so
 *  the engine allows it; the UI uses this to warn first and to keep the
 *  double-click fast path off it. "Nothing" = it would skip at least one
 *  benefit and run none (costs alone don't count). */
export function idleOperationReason(
	state: GameState,
	seat: Seat,
	iid: CardInstanceId,
	opIndex: number,
): string | null {
	const card = state.cards[iid]
	const op =
		card === undefined ? undefined : cardDef(card.def).operations[opIndex]
	if (op === undefined) return null
	// a PLAY runs with the card already in the Staging Area (as canPlay probes)
	const at =
		op.type === 'PLAY' ? moveCard(state, iid, { k: 'STAGING', seat }) : state
	const out = probeOutcome(at, op.effect, PLAIN_CTX(seat, iid))
	if (!out.ok || out.benefits > 0 || out.skipped.length === 0) return null
	return out.skipped.map(describeSafe).join(' ')
}

function describeSafe(node: Parameters<typeof describe>[0]): string {
	try {
		return describe(node)
	} catch {
		return node.k
	}
}

/** May `seat` complete mission `index`? (goal met and not already completed). */
export function canComplete(
	state: GameState,
	seat: Seat,
	index: number,
): boolean {
	const m = player(state, seat).missions[index]
	if (!m || m.completed) return false
	return evalPredicate(state, m.goal, PLAIN_CTX(seat, '' as CardInstanceId))
}

/** Indices of `seat`'s missions whose goals are currently met. */
export function completableMissions(state: GameState, seat: Seat): number[] {
	const out: number[] = []
	for (let i = 0; i < player(state, seat).missions.length; i++) {
		if (canComplete(state, seat, i)) out.push(i)
	}
	return out
}

// ---------------------------------------------------------------------------
// Shared per-operation gate
// ---------------------------------------------------------------------------

/** requires + action cost + probe dry-run. */
function operationResolvable(
	state: GameState,
	seat: Seat,
	iid: CardInstanceId,
	op: Operation,
): boolean {
	if (op.requires) {
		if (!meetsRequirement(state, seat, op.requires)) return false
	}
	if (op.costsAction && player(state, seat).actions.available <= 0) return false
	return probe(state, op.effect, PLAIN_CTX(seat, iid))
}

/** One-line "why not" for the UI. */
function operationBlockReason(
	state: GameState,
	seat: Seat,
	op: Operation,
): string {
	if (op.requires) {
		const have = player(state, seat).specialties[op.requires.specialty]
		if (!meetsRequirement(state, seat, op.requires)) {
			return `Requires ${op.requires.specialty} ${op.requires.min} (you have ${have})`
		}
	}
	if (op.costsAction && player(state, seat).actions.available <= 0) {
		return `Requires an action (you have none available)`
	}
	return 'Effect cannot be fully resolved'
}
