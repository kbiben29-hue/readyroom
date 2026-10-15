// §9 WILDCARD matching + DIFFERENT_SPECIES (docs/effect-dsl.md §5, rules/05
// §5.2.3, rules/12 §12.12, todo/04 §9):
//   - matchTrait honours allowWildcard / actorMayOptIn;
//   - DIFFERENT_SPECIES is a real matching problem: 1 BAJORAN + 1 KLINGON +
//     1 WILDCARD ⇒ 3 different species;
//   - a declared wildcardAs substitutes for exactly one trait and is cleared
//     when the operation ends.

import { describe, expect, it } from 'vitest'
import { fresh, register, makeDef, place, ID } from '../resolver/testUtils'
import { matchTrait, differentSpeciesCount } from './traits'
import { evalPredicate } from './resolveQuery'
import { clearWildcards } from '../state'
import type { GameState } from '../state'
import type { TraitId } from '../../data/ids'

function speciesState(): GameState {
	register([
		makeDef({
			id: 'bajoran',
			suit: 'PERSON',
			traits: ['BAJORAN'],
			operations: [],
		}),
		makeDef({
			id: 'klingon',
			suit: 'PERSON',
			traits: ['KLINGON'],
			operations: [],
		}),
		makeDef({
			id: 'wild',
			suit: 'PERSON',
			traits: ['WILDCARD'],
			operations: [],
		}),
	])
	let s = fresh()
	s = place(s, 'bajoran', ID('b'), { k: 'FLEET', seat: 0 }, 0)
	s = place(s, 'klingon', ID('k'), { k: 'FLEET', seat: 0 }, 0)
	s = place(s, 'wild', ID('w'), { k: 'FLEET', seat: 0 }, 0)
	return s
}

describe('matchTrait', () => {
	it('a genuine trait always matches regardless of allowWildcard', () => {
		const s = speciesState()
		expect(
			matchTrait(s, ID('b'), 'BAJORAN', {
				allowWildcard: false,
				actorMayOptIn: false,
			}),
		).toBe(true)
		expect(
			matchTrait(s, ID('b'), 'KLINGON', {
				allowWildcard: false,
				actorMayOptIn: false,
			}),
		).toBe(false)
	})

	it('a WILDCARD matches only when allowWildcard (never compelled)', () => {
		const s = speciesState()
		expect(
			matchTrait(s, ID('w'), 'BAJORAN', {
				allowWildcard: true,
				actorMayOptIn: true,
			}),
		).toBe(true)
		// forced events / final scoring: allowWildcard false → the wildcard counts for nothing
		expect(
			matchTrait(s, ID('w'), 'BAJORAN', {
				allowWildcard: false,
				actorMayOptIn: false,
			}),
		).toBe(false)
	})

	it('a declared wildcardAs matches that trait even when the wild is already locked in', () => {
		const s = speciesState()
		const declared = {
			...s,
			cards: {
				...s.cards,
				w: { ...s.cards.w!, wildcardAs: 'VULCAN' as TraitId },
			},
		}
		expect(
			matchTrait(declared, ID('w'), 'VULCAN', {
				allowWildcard: false,
				actorMayOptIn: false,
			}),
		).toBe(true)
	})
})

describe('DIFFERENT_SPECIES_IN_PLAY', () => {
	it('1 BAJORAN + 1 KLINGON + 1 WILDCARD satisfies 3 different species', () => {
		const s = speciesState()
		const ctx = { actor: 0 as 0 | 1, source: ID('b'), bindings: {} }
		expect(
			evalPredicate(s, { k: 'DIFFERENT_SPECIES_IN_PLAY', count: 3 }, ctx),
		).toBe(true)
		// remove the wildcard from the state entirely (inPlayCards iterates cards)
		const noWild = { ...s, cards: { b: s.cards.b!, k: s.cards.k! } }
		expect(
			evalPredicate(noWild, { k: 'DIFFERENT_SPECIES_IN_PLAY', count: 3 }, ctx),
		).toBe(false)
		expect(
			evalPredicate(noWild, { k: 'DIFFERENT_SPECIES_IN_PLAY', count: 2 }, ctx),
		).toBe(true)
	})

	it('two same-species cards + a wildcard cannot make 3 distinct species', () => {
		const s = speciesState()
		const swapped = {
			...s,
			cards: { ...s.cards, k: { ...s.cards.k!, def: 'bajoran' } },
		}
		const ctx = { actor: 0 as 0 | 1, source: ID('b'), bindings: {} }
		expect(
			evalPredicate(swapped, { k: 'DIFFERENT_SPECIES_IN_PLAY', count: 3 }, ctx),
		).toBe(false)
		expect(
			evalPredicate(swapped, { k: 'DIFFERENT_SPECIES_IN_PLAY', count: 2 }, ctx),
		).toBe(true)
		void ctx
	})

	it('a declared wildcardAs species collapses with a same-species card', () => {
		const s = speciesState()
		// only the wildcard declares BAJORAN; the genuine BAJORAN + KLINGON stay
		const swapped = {
			...s,
			cards: {
				...s.cards,
				w: { ...s.cards.w!, wildcardAs: 'BAJORAN' as TraitId },
			},
		}
		// BAJORAN + KLINGON + W(→BAJORAN) → at most 2 distinct species
		expect(
			differentSpeciesCount(swapped, [ID('b'), ID('k'), ID('w')], {
				allowWildcard: true,
			}),
		).toBe(2)
	})
})

describe('wildcardAs lifecycle (rules/12 §12.12)', () => {
	it('clearWildcards resets every transient declaration', () => {
		let s = speciesState()
		s = {
			...s,
			cards: {
				...s.cards,
				w: { ...s.cards.w!, wildcardAs: 'VULCAN' as TraitId },
			},
		}
		expect(s.cards.w!.wildcardAs).toBe('VULCAN')
		const cleared = clearWildcards(s)
		expect(cleared.cards.w!.wildcardAs).toBeNull()
	})
})
