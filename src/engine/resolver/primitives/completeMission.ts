import type { Effect } from '../nodes'
import type { Primitive } from './index'
import {
	inPlayCards,
	otherSeat,
	player,
	type GameState,
	type JsonValue,
} from '../../state'
import { answered, answer, emit, moveCard, suspend } from '../runtime'
import { evalPredicate } from '../../queries/resolveQuery'
import { ATTACK_BINDING, closePending, openAttack } from '../replacement'
import { registerScript } from './script'
import type { Predicate, Seat } from '../queries'
import type { EffectCtx } from '../../state'
import type { CardInstanceId } from '../../ids'

/** COMPLETE_MISSION (docs/effect-dsl.md §4, rules/07 §7.2.1): mark a mission
 *  completed and resolve its REWARD effect. Todo/10 finalises the gate: a
 *  mission can only be completed while its GOAL is met (`canResolve` refuses
 *  otherwise) and only once. The mission's printed VP is scored at final
 *  scoring (§7.4.1 #6, Advanced side only) — completion places the token now.
 *
 *  §7.2.1 step 2 — dismiss every BEAMED card that contributed to the goal
 *  (rules/12 §12.26) — is implemented here. A sole witness set auto-dismisses;
 *  several sets surface as a CHOOSE_WITNESS PendingChoice (docs/data-model.md
 *  §6, docs/open-questions.md Q4: the player chooses). Deployed SHIPs,
 *  LOCATIONs and Staging-Area contributors are never dismissed — they are not
 *  in the witness candidates. Reward effects are pushed ON TOP of the
 *  completion so the stack machine resolves them before the (possibly
 *  resumable) dismissal, matching the §7.2.1 step order. */
export const completeMission: Primitive<
	Extract<Effect, { k: 'COMPLETE_MISSION' }>
> = {
	isCost: false,
	canResolve(state, node, ctx) {
		// The resume frame (witness already chosen / preset) always runs — the
		// mission is already completed by then, so the normal gate would refuse it.
		if (answered(ctx, WITNESS_KEY)) return true
		const missions = player(state, ctx.actor).missions
		const index = targetIndex(missions, node.index)
		if (index === undefined) return false
		const m = missions[index]
		if (m === undefined || m.completed) return false
		// Goal must be met right now (rules/07 §7.2 — "while a mission's GOAL is
		// met, you may complete it").
		return evalPredicate(state, m.goal, ctx)
	},
	execute(state, node, ctx, _frame) {
		// Resume path: dismiss the chosen witness set (the reward frame sits below
		// on the stack, so the reward resolved first — §7.2.1 steps 1 then 2).
		if (answered(ctx, WITNESS_KEY)) {
			return dismissWitnesses(
				state,
				ctx.actor,
				answer<CardInstanceId[]>(ctx, WITNESS_KEY),
			)
		}

		const p = player(state, ctx.actor)
		const index = targetIndex(p.missions, node.index)
		if (index === undefined) return state
		const m = p.missions[index]
		if (!m || m.completed) return state
		if (!evalPredicate(state, m.goal, ctx)) return state

		const missions = p.missions.map((mm, i) =>
			i === index ? { ...mm, completed: true } : mm,
		)
		const players = state.players.map((pl) =>
			pl.seat === ctx.actor ? { ...pl, missions } : pl,
		) as [GameState['players'][0], GameState['players'][1]]

		const next: GameState = emit(
			{ ...state, players },
			{ k: 'MISSION_COMPLETED', seat: ctx.actor, index },
		)

		// §7.2.1 step 2: beamed cards that contributed to the goal are dismissed.
		const sets = witnessSets(next, m.goal, ctx)
		const reward = m.reward

		// An "Attack Reward" (1KOL/M3) resolves as an ATTACK on the opponent:
		// open the pending attack record (so "would be attacked" windows fire
		// for its negative effects) and close it — emitting ATTACKED — once the
		// reward is done, exactly like an ATTACK operation (stack.ts).
		let base: GameState = next
		let rewardCtx: EffectCtx = ctx
		let attackDone: GameState['stack'][number] | null = null
		if (m.isAttack === true && reward.k !== 'NOOP') {
			const o = openAttack(
				base,
				`mission:${ctx.actor}:${index}` as CardInstanceId,
				index,
				ctx.actor,
			)
			base = o.state
			rewardCtx = {
				...ctx,
				bindings: {
					...ctx.bindings,
					'$op.isAttack': true,
					'$op.seat': ctx.actor,
					[ATTACK_BINDING]: o.id,
				},
			}
			attackDone = {
				k: 'EFFECT',
				node: { k: 'SCRIPT', fn: 'mission.attackDone' },
				ctx: rewardCtx,
				ip: 0,
			}
		}

		// Reward frame (bare EFFECT — mission rewards are benefits, not ops).
		const rewardFrames: GameState['stack'] =
			reward.k === 'NOOP'
				? []
				: [
						...(attackDone === null ? [] : [attackDone]),
						{ k: 'EFFECT', node: reward, ctx: rewardCtx, ip: 0 },
					] // reward on top (LIFO) → resolves first, then the attack closes

		if (sets.length > 1) {
			// Several satisfying sets: the player picks (Q4). The reward frame is
			// pushed after suspend, so LIFO resolves reward → dismissal.
			const s = suspend(base, node, ctx, WITNESS_KEY, {
				k: 'CHOOSE_WITNESS',
				prompt:
					'Which beamed cards contributed to this mission? (they are dismissed)',
				sets,
			})
			return { ...s, stack: [...s.stack, ...rewardFrames] }
		}

		if (sets.length === 1 && sets[0]!.length > 0) {
			// Sole witness set: dismiss after the reward, through the same resume
			// machinery with the selection pre-seeded (no user choice needed).
			const token = `mission.witness.preset:${index}`
			const bindings: Record<string, JsonValue> = {
				...ctx.bindings,
				[WITNESS_KEY]: token,
				[token]: sets[0]!,
			}
			const resumeFrame: GameState['stack'][number] = {
				k: 'EFFECT',
				node,
				ctx: { ...ctx, bindings },
				ip: 0,
			}
			return { ...base, stack: [...base.stack, resumeFrame, ...rewardFrames] }
		}

		// No beamed contributor: just the reward.
		return { ...base, stack: [...base.stack, ...rewardFrames] }
	},
}

// "Attack Reward" epilogue: the reward is done — close the pending attack
// record and tell the victim it was attacked (stack.ts OPERATION phase 1).
registerScript('mission.attackDone', {
	canResolve: () => true,
	execute: (state, _node, ctx) => {
		const id = ctx.bindings[ATTACK_BINDING]
		const closed = typeof id === 'string' ? closePending(state, id) : state
		return emit(closed, {
			k: 'ATTACKED',
			seat: ctx.actor,
			victim: otherSeat(ctx.actor),
		})
	},
})

/** Upper bound on goal evaluations spent searching minimum witness sets
 *  before falling back to one greedy inclusion-minimal set. */
const WITNESS_BUDGET = 4000

/**
 * The candidate witness sets — the BEAMED cards whose contribution the goal
 * needs (rules/07 §7.2.1 step 2, rules/12 §12.26, docs/data-model.md §6).
 * Goal-agnostic: a set W of the actor's beamed in-play cards is a witness
 * when the goal still holds with every OTHER beamed card taken out of play.
 * Returned: every smallest such set (the player picks one — Q4), or [] when
 * the goal holds with no beamed card at all (deployed SHIPs, LOCATIONs,
 * Staging cards and beamed SKILL icons — §12.5 — are never dismissed). This
 * covers every goal form — COUNT, SAME_SHIP (distinct cards per
 * requirement), DIFFERENT_SPECIES, and AND/OR combinations — so exactly the
 * contributing cards are dismissed. Mission goals are monotone (more cards
 * never break them), which the search relies on.
 */
export function witnessSets(
	state: GameState,
	goal: Predicate,
	ctx: EffectCtx,
): CardInstanceId[][] {
	const beamed = inPlayCards(state, ctx.actor).filter(
		(iid) => state.cards[iid]!.zone.k === 'BEAMED',
	)
	if (beamed.length === 0) return []
	let evals = 0
	const holdsWith = (keep: readonly CardInstanceId[]): boolean => {
		evals++
		const drop = beamed.filter((iid) => !keep.includes(iid))
		return evalPredicate(withoutCards(state, drop), goal, ctx)
	}
	if (holdsWith([])) return [] // met without any beamed card
	if (!holdsWith(beamed)) return [] // defensive: goal not met at all

	// Cards every witness needs: dropping one alone breaks the goal.
	const required = beamed.filter(
		(iid) => !holdsWith(beamed.filter((b) => b !== iid)),
	)
	if (holdsWith(required)) return [required]
	const optional = beamed.filter((iid) => !required.includes(iid))

	for (let k = 1; k <= optional.length; k++) {
		const found: CardInstanceId[][] = []
		for (const combo of combinations(optional, k)) {
			if (evals > WITNESS_BUDGET) return [greedyWitness(beamed, holdsWith)]
			const set = [...required, ...combo]
			if (holdsWith(set)) found.push(set)
		}
		if (found.length > 0) return found
	}
	return [greedyWitness(beamed, holdsWith)]
}

/** One inclusion-minimal witness: drop beamed cards one by one while the
 *  goal still holds. */
function greedyWitness(
	beamed: CardInstanceId[],
	holdsWith: (keep: readonly CardInstanceId[]) => boolean,
): CardInstanceId[] {
	let keep = [...beamed]
	for (const iid of beamed) {
		const without = keep.filter((k) => k !== iid)
		if (holdsWith(without)) keep = without
	}
	return keep
}

/** A read-only hypothetical: `state` with `drop` taken out of play (moved to
 *  the box) — only used to evaluate a goal, never stored. */
function withoutCards(
	state: GameState,
	drop: readonly CardInstanceId[],
): GameState {
	if (drop.length === 0) return state
	const cards = { ...state.cards }
	const zones = { ...state.zones }
	for (const iid of drop) {
		const card = cards[iid]
		if (card === undefined) continue
		if (card.zone.k === 'BEAMED') {
			const key = `BEAMED:${card.zone.host}`
			zones[key] = (zones[key] ?? []).filter((x) => x !== iid)
		}
		cards[iid] = { ...card, zone: { k: 'BOX' }, beamedTo: null }
	}
	return { ...state, cards, zones }
}

function combinations<T>(list: T[], k: number): T[][] {
	if (k === 0) return [[]]
	if (k > list.length) return []
	const out: T[][] = []
	const rec = (start: number, chosen: T[]): void => {
		if (chosen.length === k) {
			out.push([...chosen])
			return
		}
		for (let i = start; i <= list.length - (k - chosen.length); i++) {
			chosen.push(list[i]!)
			rec(i + 1, chosen)
			chosen.pop()
		}
	}
	rec(0, [])
	return out
}

/** Move the chosen beamed contributors to their owner's Discard (emit a
 *  CARD_DISMISSED mirror per card, matching the DISMISS primitive). Cards that
 *  have since left the BEAMED zone are skipped defensively. */
function dismissWitnesses(
	state: GameState,
	seat: Seat,
	chosen: CardInstanceId[],
): GameState {
	let s = state
	for (const iid of chosen) {
		const card = s.cards[iid]
		if (card === undefined || card.zone.k !== 'BEAMED') continue
		s = emit(moveCard(s, iid, { k: 'DISCARD', seat: card.owner ?? seat }), {
			k: 'CARD_DISMISSED',
			iid,
			seat,
		})
	}
	return s
}

const WITNESS_KEY = 'mission.witness'

/** The mission to target: the explicit index, else the first uncompleted. */
function targetIndex(
	missions: GameState['players'][number]['missions'],
	index?: number | undefined,
): number | undefined {
	if (index !== undefined) return index
	const open = missions.findIndex((m) => !m.completed)
	return open < 0 ? undefined : open
}
