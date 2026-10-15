// Trait semantics (todo/04 provisional; todo/05 §5 hardens). WILDCARD handling
// per docs/effect-dsl.md §5 and rules/05 §5.2.3: a WILDCARD trait can be
// treated as any single trait for one operation or one goal — owner's choice,
// opt-in, never compelled. Final scoring and forced dismissals pass
// `allowWildcard: false`.

import { cardDef } from '../cards'
import type { GameState, CardInstance } from '../state'
import type { CardInstanceId } from '../ids'
import { isSpecies, type SpeciesTrait, type TraitId } from '../../data/ids'
import { grantedTraits } from '../modifiers'

export interface MatchOpts {
	/** A WILDCARD card may be treated as the trait. False for forced events,
	 *  attacks and final scoring. */
	allowWildcard: boolean
	/** The owner may opt in — surface a CHOOSE_WILDCARD_AS rather than silently
	 *  counting. (todo/07 wires the full surfacing path.) */
	actorMayOptIn: boolean
}

/** The card's EFFECTIVE traits: printed traits + traits granted by attached
 *  rule-modifier layers (a SHIP counting as CLOAK until the turn ends —
 *  TEMP_CLOAK, 1KOL03/1CAR03). Every trait check goes through
 *  this (or `cardTraits`), never through `cardDef(..).traits` directly. */
export function effectiveTraits(
	state: GameState,
	iid: CardInstanceId,
): TraitId[] {
	const card = state.cards[iid]
	if (!card) return []
	const printed = cardDef(card.def).traits
	const granted = grantedTraits(state, iid)
	if (granted.length === 0) return printed
	return [...printed, ...granted.filter((t) => !printed.includes(t))]
}

/** The traits a card genuinely carries (effective traits + any declared
 *  wildcardAs). */
export function cardTraits(state: GameState, iid: CardInstanceId): TraitId[] {
	const card = state.cards[iid]
	if (!card) return []
	const out = [...effectiveTraits(state, iid)]
	if (card.wildcardAs !== null) out.push(card.wildcardAs)
	return out
}

export function cardIsWildcard(card: CardInstance): boolean {
	return cardDef(card.def).traits.includes('WILDCARD')
}

/**
 * Does `iid` count as `trait`? A WILDCARD card counts when `allowWildcard` is
 * true — either because it already declared `wildcardAs === trait`, or because
 * the player may still opt in (rules/12 §12.12: never compelled).
 */
export function matchTrait(
	state: GameState,
	iid: CardInstanceId,
	trait: TraitId,
	opts: MatchOpts,
): boolean {
	const card = state.cards[iid]
	if (!card) return false
	const traits = effectiveTraits(state, iid)
	if (traits.includes(trait)) return true
	if (card.wildcardAs === trait) return true
	if (
		opts.allowWildcard &&
		(traits.includes('WILDCARD') || card.wildcardAs !== null)
	) {
		return true
	}
	return false
}

/** Every species trait (rules/05 §5.2.3) — the candidates of a WILDCARD. */
export const ALL_SPECIES = [
	'ALIEN',
	'AENAR',
	'ANDORIAN',
	'ANDROID',
	'BAJORAN',
	'BETAZOID',
	'BORG',
	'BREEN',
	'CARDASSIAN',
	'CHANGELING',
	'FERENGI',
	'HUMAN',
	'KAZON',
	'KELPIEN',
	'KLINGON',
	'ORION',
	'PAKLED',
	'REMAN',
	'ROMULAN',
	'SYNTHETIC',
	'TELLARITE',
	'TRANSCENDENT',
	'TRILL',
	'VAU_NAKAT',
	'VULCAN',
	'XINDI',
] as const satisfies readonly SpeciesTrait[]

export interface KindOpts {
	allowWildcard: boolean
	/** a card bearing one of these counts as its own kind (ALIEN and
	 *  TRANSCENDENT cards each count separately — 1PIC/M3) */
	eachDistinct?: readonly TraitId[] | undefined
}

/** The "kinds" `iid` can stand for among `of` (default: the species): one
 *  label per trait it bears (effective traits + a declared wildcardAs); a
 *  WILDCARD may be any one of them while `allowWildcard`. A trait in
 *  `eachDistinct` yields a label unique to this card. */
export function kindLabels(
	state: GameState,
	iid: CardInstanceId,
	opts: KindOpts,
	of?: readonly TraitId[] | undefined,
): string[] {
	const card = state.cards[iid]
	if (!card) return []
	const inScope = (t: TraitId): boolean =>
		of === undefined ? isSpecies(t) : of.includes(t)
	let traits: TraitId[]
	if (cardIsWildcard(card) && opts.allowWildcard) {
		// may be any one of them (or its declared one)
		traits =
			card.wildcardAs !== null && inScope(card.wildcardAs)
				? [card.wildcardAs]
				: [...(of ?? ALL_SPECIES)]
	} else {
		traits = cardTraits(state, iid).filter(inScope)
	}
	const out = new Set<string>()
	for (const t of traits)
		out.add(opts.eachDistinct?.includes(t) === true ? `${t}#${iid}` : t)
	return [...out]
}

/**
 * Maximum number of DISTINCT species representable by the given cards
 * (rules/05 §5.2.3, docs/effect-dsl.md §5): bipartite matching of
 * species-bearing cards ↔ distinct species. A WILDCARD card can be any one
 * species; n is tiny (< 20), so Kuhn's augmenting-path algorithm is plenty.
 */
export function differentSpeciesCount(
	state: GameState,
	iids: CardInstanceId[],
	opts: KindOpts,
): number {
	const candidates = iids.map((iid) => kindLabels(state, iid, opts))
	const matchOf = new Map<string, number>() // label -> cardIdx

	const tryAug = (cardIdx: number, seen: Set<string>): boolean => {
		for (const label of candidates[cardIdx]!) {
			if (seen.has(label)) continue
			seen.add(label)
			const owner = matchOf.get(label)
			if (owner === undefined || tryAug(owner, seen)) {
				matchOf.set(label, cardIdx)
				return true
			}
		}
		return false
	}

	let count = 0
	for (let i = 0; i < iids.length; i++) {
		if (tryAug(i, new Set())) count++
	}
	return count
}
