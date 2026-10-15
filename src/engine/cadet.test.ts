// Cadet Training engine rules (todo/15 §1, rules/10) — the mode-specific
// behaviour layered on the shared engine:
//   §10.2 #3 the "one of everything" virtual opponent (steal / away-team clamps)
//   §10.2 #4 forced-INCIDENT substitution (you gain 1 Glory, deck not depleted)
//   §10.3   the BUR 1-DIL variant + the self-handoff of an emptied Stardate
//          with the next card's printed Glory (the turn-6 wipe refill)
// The fixed 5/10/11-turn timeline and full-game determinism live in
// cadet-game.test.ts; the pure interceptor functions themselves live in
// src/bot/cadet.ts (covered through their engine call sites here and directly
// in cadet-game.test.ts).

import { describe, expect, it } from 'vitest'
import type { Effect } from './resolver/nodes'
import type { GameState } from './state'
import { newGameState, player, zonesOf } from './state'
import { cleanupGloryEffect } from './modifiers'
import {
	handoffStardate,
	stealResource,
	STARDATE_REFILL_GLORY,
} from './resolver/runtime'
import {
	pushAndRun,
	place,
	register,
	makeDef,
	ID,
	setResources,
} from './resolver/testUtils'
import {
	opponentResource,
	opponentAwayTeamsAt,
	opponentShipTokensAt,
	opponentHandSize,
} from '../bot/cadet'

const CTX = { actor: 0 as 0 | 1, source: ID('src'), bindings: {} }

const GLO_AMOUNT: Effect = { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 }

describe('rules/10 §10.2 #3 — the virtual opponent has one of everything', () => {
	it('the interceptor answers the documented quantities (1 / 1 / 0 / 1)', () => {
		expect(opponentResource('DIL')).toBe(1)
		expect(opponentAwayTeamsAt('anything')).toBe(1)
		expect(opponentShipTokensAt('anything')).toBe(0) // the one explicit exception
		expect(opponentHandSize()).toBe(1)
	})

	it('"steal 3 Dilithium" steals exactly 1 (direct runtime clamp)', () => {
		let s = setResources(newGameState(1, { mode: 'CADET' }), 0, 'DIL', 0)
		s = stealResource(s, 1, 0, 'DIL', 3) // from the cadet to the human
		expect(player(s, 0).resources.DIL).toBe(1)
		// the virtual pile is permanent: a second steal still yields 1
		s = stealResource(s, 1, 0, 'DIL', 3)
		expect(player(s, 0).resources.DIL).toBe(2)
	})

	it('a STEAL effect resolves to exactly 1 through the resolver', () => {
		let s = setResources(newGameState(1, { mode: 'CADET' }), 0, 'DIL', 0)
		s = pushAndRun(s, { k: 'STEAL', res: 'DIL', amount: 3 }, CTX.source, 0)
		expect(player(s, 0).resources.DIL).toBe(1)
	})

	it('in TWO_PLAYER mode the interceptor is inert (a real steal reads the vault)', () => {
		let s = setResources(newGameState(1), 0, 'DIL', 0)
		// seat 1 does hold 2 DIL: the steal takes both
		s = {
			...s,
			players: [
				s.players[0],
				{ ...s.players[1], resources: { ...s.players[1].resources, DIL: 2 } },
			] as GameState['players'],
		}
		s = stealResource(s, 1, 0, 'DIL', 3)
		expect(player(s, 0).resources.DIL).toBe(2)
		expect(player(s, 1).resources.DIL).toBe(0)
	})
})

describe('rules/10 §10.2 #3 — away-team quantities clamp to the one virtual team', () => {
	function withNeutral(): GameState {
		register([makeDef({ id: 'loc', suit: 'LOCATION', operations: [] })])
		let s = newGameState(1, { mode: 'CADET' })
		s = place(s, 'loc', ID('L1'), { k: 'NEUTRAL_ZONE', slot: 0 })
		return s
	}

	it('REMOVE_AWAY_TEAM count 2, whose OPPONENT, on the cadet removes 1 — and the per-token Glory gain pays 1', () => {
		let s = withNeutral()
		// "remove up to 2 opponent Away Teams; gain 1 Glory per Away Team removed"
		const effect: Effect = {
			k: 'SEQ',
			steps: [
				{
					k: 'REMOVE_AWAY_TEAM',
					count: 2,
					target: { zones: [{ k: 'NEUTRAL_ZONE', slot: 0 }] },
					whose: 'OPPONENT',
				},
				// the gain sizes itself from the opponent-away-team COUNT -> clamps to 1
				GLO_AMOUNT,
			],
		}
		const before = JSON.stringify(s)
		s = pushAndRun(s, effect, CTX.source, 0)
		// no real away teams existed anywhere, so the board is untouched by the removal
		expect(
			JSON.stringify(s) === before
				? true
				: Object.values(s.awayTeamsAt).every(([a, b]) => a === 0 && b === 0),
		).toBe(true)
		expect(player(s, 0).resources.GLO).toBe(1) // exactly 1 Glory, not 2
	})
})

describe('rules/10 §10.2 #4 — forced INCIDENT on the opponent substitutes 1 Glory', () => {
	it('TAKE(INCIDENT) forced onto the cadet gives you 1 Glory and does NOT deplete the deck', () => {
		register([makeDef({ id: 'inc', suit: 'INCIDENT', operations: [] })])
		let s = newGameState(1, { mode: 'CADET' })
		s = place(s, 'inc', ID('i1'), { k: 'INCIDENT_DECK' })
		s = place(s, 'inc', ID('i2'), { k: 'INCIDENT_DECK' })
		const before = zonesOf(s, { k: 'INCIDENT_DECK' }).length
		s = pushAndRun(
			s,
			{ k: 'FORCE', body: { k: 'TAKE', deck: 'INCIDENT', count: 1 } },
			CTX.source,
			0,
		)
		expect(player(s, 0).resources.GLO).toBe(1)
		expect(zonesOf(s, { k: 'INCIDENT_DECK' })).toHaveLength(before)
		expect(
			Object.values(s.cards).some(
				(c) => c.def === 'inc' && c.owner === 1 && c.zone.k === 'HAND',
			),
		).toBe(false)
	})

	it("the substitution does not fire for ENCOUNTERs or for the human's own TAKEs", () => {
		register([
			makeDef({ id: 'inc', suit: 'INCIDENT', operations: [] }),
			makeDef({ id: 'enc', suit: 'ENCOUNTER', operations: [] }),
		])
		let s = newGameState(1, { mode: 'CADET' })
		s = place(s, 'inc', ID('i1'), { k: 'INCIDENT_DECK' })
		s = place(s, 'inc', ID('i2'), { k: 'INCIDENT_DECK' }) // a second incident keeps the deck from emptying (no Burn mid-test)
		s = place(s, 'enc', ID('e1'), { k: 'ENCOUNTER_DECK' })
		const deckBefore = zonesOf(s, { k: 'INCIDENT_DECK' }).length
		// human takes their OWN incident (normal): no substitution
		s = pushAndRun(s, { k: 'TAKE', deck: 'INCIDENT', count: 1 }, CTX.source, 0)
		expect(player(s, 0).resources.GLO).toBe(0)
		expect(zonesOf(s, { k: 'INCIDENT_DECK' })).toHaveLength(deckBefore - 1)
		// forced ENCOUNTER onto the cadet: no substitution, the deck is depleted
		const encBefore = zonesOf(s, { k: 'ENCOUNTER_DECK' }).length
		s = pushAndRun(
			s,
			{ k: 'FORCE', body: { k: 'TAKE', deck: 'ENCOUNTER', count: 1 } },
			CTX.source,
			0,
		)
		expect(player(s, 0).resources.GLO).toBe(0)
		expect(zonesOf(s, { k: 'ENCOUNTER_DECK' })).toHaveLength(encBefore - 1)
	})
})

describe('rules/10 §10.3 — handoff & BUR variant', () => {
	it("an emptied Stardate is handed to the SAME player in Cadet mode and refills the next card's printed Glory", () => {
		let s = newGameState(1, { mode: 'CADET' })
		s = {
			...s,
			stardates: {
				pile: [ID('sd-a'), ID('sd-b')],
				gloryOnTop: 0,
				glories: [5, 5],
			},
		}
		const out = handoffStardate(s, 0)
		expect(out.players[0].heldStardate).toBe(ID('sd-a'))
		expect(out.players[1].heldStardate).toBeNull() // never to the (virtual) opponent
		expect(out.stardates.pile).toEqual([ID('sd-b')])
		expect(out.stardates.gloryOnTop).toBe(5) // the second Cadet card prints 5 (turn-6 refill)
		expect(out.resolutionTriggered).toBe(false)
	})

	it('two-player handoff still passes to the opponent (regression)', () => {
		let s = newGameState(1) // TWO_PLAYER
		s = { ...s, stardates: { pile: [ID('sd-a'), ID('sd-b')], gloryOnTop: 0 } }
		const out = handoffStardate(s, 0)
		expect(out.players[1].heldStardate).toBe(ID('sd-a'))
		expect(out.players[0].heldStardate).toBeNull()
		expect(out.stardates.gloryOnTop).toBe(STARDATE_REFILL_GLORY) // no glories → flat fallback
	})

	it('BUR places exactly 1 DIL in Cadet mode, 2 in two-player (rules/10 §10.3, rules/11 §11.6.1)', () => {
		const withMod = (s: GameState): GameState => ({
			...s,
			players: [
				{
					...s.players[0],
					modifiers: [{ id: '1BUR02', source: ID('x') }],
				},
				s.players[1],
			] as GameState['players'],
		})
		const cadet = withMod(newGameState(1, { mode: 'CADET' }))
		const twoP = withMod(newGameState(1))
		expect(cleanupGloryEffect(cadet, 0)).toEqual({
			k: 'SEQ',
			steps: [{ k: 'PLACE_RESOURCE_ON_MARKET', res: 'DIL', amount: 1 }],
		})
		expect(cleanupGloryEffect(twoP, 0)).toEqual({
			k: 'SEQ',
			steps: [{ k: 'PLACE_RESOURCE_ON_MARKET', res: 'DIL', amount: 2 }],
		})
	})
})
