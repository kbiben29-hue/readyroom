// Skill/focus icon counting (todo/05 §5, rules/09 §9.1, rules/12 §12.3/§12.5,
// rules/07 §7.1.3 & §7.4.1):
//   - countSkillIcons: SKILL icons on the player's in-play cards whose zone
//     counts skills — STAGING yes, BEAMED no (rules/12 §12.3 vs §12.5).
//     SKILL_ANY counts as whichever specialty is being counted (rules/09
//     §9.1: chosen per use, independently per query); SKILL_VARIABLE counts
//     only while the card's per-card condition holds, then as each listed
//     specialty.
//   - countFocusIcons: FOCUS icons over ALL owned cards — final scoring counts
//     "everything you own", including the Captain's Log and beamed cards
//     (rules/07 §7.4.1 #5).
//   - exhibitsSpecialty: Skill OR Focus, never a restriction icon
//     (rules/07 §7.1.3).

import { cardDef } from '../cards'
import { inPlayCards } from './inPlay'
import { owned, zoneProps, type GameState, type EffectCtx } from '../state'
import { evalAmount, evalPredicate } from './resolveQuery'
import type { CardDef } from '../../data/schema'
import type { SpecialtyId } from '../../data/ids'
import type { CardInstanceId } from '../ids'
import type { Seat, VariableSkillSpec } from '../resolver/queries'

const ctxOf = (seat: Seat, source: CardInstanceId): EffectCtx => ({
	actor: seat,
	source,
	bindings: {},
})

/** Does `def` print a Skill or Focus icon of `specialty` (rules/07 §7.1.3)?
 *  SKILL_ANY counts as any; SKILL_VARIABLE counts via its static skill list
 *  (the condition is evaluated when icons are *counted*, not here — this test
 *  takes no state and cannot). A card with only a coloured restriction icon
 *  never matches. */
export function exhibitsSpecialty(
	def: CardDef,
	specialty: SpecialtyId,
): boolean {
	const want = `SKILL_${specialty}`
	for (const icon of def.skills) {
		if (icon === want || icon === 'SKILL_ANY') return true
		if (
			icon === 'SKILL_VARIABLE' &&
			def.variableSkill !== undefined &&
			variableSpecialties(def.variableSkill).includes(specialty)
		) {
			return true
		}
	}
	return def.focus === `FOCUS_${specialty}`
}

/** SKILL icons of `specialty` in play for `seat` (SKILL_ANY assignable per
 *  use; SKILL_VARIABLE conditional). Beamed cards never count (rules/12
 *  §12.5); Staging cards always do (§12.3). */
export function countSkillIcons(
	state: GameState,
	seat: Seat,
	specialty: SpecialtyId,
): number {
	let total = 0
	for (const iid of inPlayCards(state, seat)) {
		const card = state.cards[iid]
		if (!card) continue
		if (!zoneProps(card.zone).skillsCount) continue // BEAMED: skills excluded
		total += skillsOnCard(state, iid, seat, specialty)
	}
	return total
}

function skillsOnCard(
	state: GameState,
	iid: CardInstanceId,
	seat: Seat,
	specialty: SpecialtyId,
): number {
	const def = cardDef(state.cards[iid]!.def)
	let n = 0
	for (const icon of def.skills) {
		if (icon === `SKILL_${specialty}` || icon === 'SKILL_ANY') {
			n++
			continue
		}
		if (icon !== 'SKILL_VARIABLE' || def.variableSkill === undefined) continue
		const spec = def.variableSkill
		if ('counts' in spec) {
			// "1 {RES-skill} for each VULCAN … you have in play" (1BUR12)
			for (const c of spec.counts)
				if (c.specialty === specialty)
					n += evalAmount(state, c.amount, ctxOf(seat, iid))
		} else if (
			spec.skills.includes(specialty) &&
			evalPredicate(state, spec.condition, ctxOf(seat, iid))
		) {
			n++
		}
	}
	return n
}

/** The specialties a SKILL_VARIABLE icon can count as. */
function variableSpecialties(spec: VariableSkillSpec): SpecialtyId[] {
	return 'counts' in spec ? spec.counts.map((c) => c.specialty) : spec.skills
}

/** FOCUS icons of `specialty` over every card `seat` owns, wherever it is
 *  (final scoring, rules/07 §7.4.1 #5). */
export function countFocusIcons(
	state: GameState,
	seat: Seat,
	specialty: SpecialtyId,
): number {
	let n = 0
	for (const iid of owned(state, seat)) {
		const def = cardDef(state.cards[iid]!.def)
		if (def.focus === `FOCUS_${specialty}`) n++
	}
	return n
}
