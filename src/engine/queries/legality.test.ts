// Legality queries (docs/state-machine.md §5, rules/03 §3.5): canPlay needs an
// in-hand card with a PLAY op whose requires / action cost / probe dry-run all
// pass; canActivate needs an in-play, table-op-zone, non-exhausted card;
// canComplete evaluates mission goals.

import { describe, expect, it } from 'vitest'
import {
	fresh,
	register,
	makeDef,
	place,
	op,
	ID,
	setSpecialty,
	setActions,
	setResources,
} from '../resolver/testUtils'
import {
	canPlay,
	canActivate,
	canComplete,
	completableMissions,
	singleLegalAction,
} from './legality'
import type { GameState } from '../state'
import { assertSerialisable } from '../invariants'

const GAIN = (res: 'DIL' | 'LAT', amount = 1) =>
	({ k: 'GAIN_RESOURCE', res, amount }) as const

function board(): GameState {
	register([
		makeDef({
			id: 'plain',
			suit: 'PERSON',
			operations: [op('PLAY', GAIN('DIL'))],
		}),
		makeDef({
			id: 'reqd',
			suit: 'PERSON',
			operations: [
				op('PLAY', GAIN('LAT'), {
					requires: { specialty: 'RESEARCH', min: 3 },
				}),
			],
		}),
		makeDef({
			id: 'act',
			suit: 'PERSON',
			operations: [op('PLAY', GAIN('DIL'), { costsAction: true })],
		}),
		makeDef({
			id: 'activ',
			suit: 'PERSON',
			operations: [
				op('ACTIVATION', GAIN('LAT'), {
					requires: { specialty: 'MILITARY', min: 2 },
				}),
			],
		}),
		makeDef({ id: 'inplay', suit: 'CARGO', operations: [] }),
	])
	let s = fresh()
	s = place(s, 'plain', ID('p'), { k: 'HAND', seat: 0 }, 0)
	s = place(s, 'reqd', ID('r'), { k: 'HAND', seat: 0 }, 0)
	s = place(s, 'act', ID('a'), { k: 'HAND', seat: 0 }, 0)
	s = place(s, 'activ', ID('v'), { k: 'FLEET', seat: 0 }, 0)
	return s
}

describe('canPlay (rules/03 §3.5.4)', () => {
	it('a plain PLAY op with no requirements is playable', () => {
		const s = setResources(board(), 0, 'DIL', 1)
		const r = canPlay(s, 0, ID('p'))
		expect(r.ok).toBe(true)
		expect(r.operations).toEqual([0])
		expect(r.reasons).toHaveLength(0)
	})

	it('an unfulfilled specialty requirement blocks with a reason', () => {
		const s = setSpecialty(board(), 0, 'RESEARCH', 2) // needs 3
		const r = canPlay(s, 0, ID('r'))
		expect(r.ok).toBe(false)
		expect(r.reasons.some((x) => x.includes('Requires RESEARCH'))).toBe(true)
		const ok = setSpecialty(s, 0, 'RESEARCH', 3)
		expect(canPlay(ok, 0, ID('r')).ok).toBe(true)
	})

	it('an [action] PLAY op needs an available action', () => {
		const noAct = setActions(board(), 0, 0)
		expect(canPlay(noAct, 0, ID('a')).ok).toBe(false)
		const withAct = setActions(board(), 0, 1)
		expect(canPlay(withAct, 0, ID('a')).ok).toBe(true)
	})

	it('a card outside the hand (or not yours) is not playable', () => {
		let s = board()
		s = place(s, 'plain', ID('p2'), { k: 'FLEET', seat: 0 }, 0) // deployed, not hand
		s = place(s, 'plain', ID('p3'), { k: 'HAND', seat: 1 }, 1) // opponent's hand
		expect(canPlay(s, 0, ID('p2')).ok).toBe(false)
		expect(canPlay(s, 0, ID('p3')).ok).toBe(false)
		expect(canPlay(s, 0, ID('p')).ok).toBe(true)
		assertSerialisable(s)
	})

	it('an unpayable cost chain makes the effect unresolvable (probe dry-run)', () => {
		register([
			makeDef({
				id: 'costly',
				suit: 'PERSON',
				operations: [
					op('PLAY', {
						k: 'PAY_THEN',
						cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 3 },
						body: GAIN('LAT'),
					}),
				],
			}),
		])
		let s = setResources(fresh(), 0, 'DIL', 2)
		s = place(s, 'costly', ID('c'), { k: 'HAND', seat: 0 }, 0)
		expect(canPlay(s, 0, ID('c')).ok).toBe(false)
		const rich = setResources(s, 0, 'DIL', 3)
		expect(canPlay(rich, 0, ID('c')).ok).toBe(true)
	})
})

describe('canActivate (rules/03 §3.5.5, rules/08 → exhaust)', () => {
	it('an ACTIVATION op on a deployed non-exhausted card resolves', () => {
		const s = setSpecialty(board(), 0, 'MILITARY', 2)
		const r = canActivate(s, 0, ID('v'), 0)
		expect(r.ok).toBe(true)
		expect(r.reason).toBeUndefined()
	})

	it('blocked when not in play, in Staging/beamed, exhausted, or missing the requirement', () => {
		let s = setSpecialty(board(), 0, 'MILITARY', 2)
		// 1. not in play (hand)
		s = place(s, 'activ', ID('v2'), { k: 'HAND', seat: 0 }, 0)
		expect(canActivate(s, 0, ID('v2'), 0).ok).toBe(false)
		// 2. Staging: in play but no table operations
		s = place(s, 'activ', ID('v3'), { k: 'STAGING', seat: 0 }, 0)
		expect(canActivate(s, 0, ID('v3'), 0).ok).toBe(false)
		// 3. beamed: same
		s = place(s, 'activ', ID('v4'), { k: 'BEAMED', host: ID('v') }, 0)
		expect(canActivate(s, 0, ID('v4'), 0).ok).toBe(false)
		// 4. exhausted
		const exhausted = {
			...s,
			cards: { ...s.cards, v: { ...s.cards.v!, exhausted: true } },
		}
		expect(canActivate(exhausted, 0, ID('v'), 0).ok).toBe(false)
		// 5. requirement unmet
		const weak = setSpecialty(board(), 0, 'MILITARY', 1)
		expect(canActivate(weak, 0, ID('v'), 0).ok).toBe(false)
		assertSerialisable(s)
	})
})

describe('canComplete (rules/07 §7.2, docs/state-machine.md §5)', () => {
	it('evaluates the mission goal and respects the completed flag', () => {
		let s = fresh()
		// mission goal: Research track ≥ 2
		s = {
			...s,
			players: s.players.map((pl) =>
				pl.seat === 0
					? {
							...pl,
							missions: [
								{
									index: 0 as const,
									goal: {
										k: 'SPECIALTY_AT_LEAST',
										specialty: 'RESEARCH',
										value: 2,
									},
									reward: { k: 'NOOP' },
									vp: 0,
									completed: false,
									text: 't',
								},
							],
						}
					: pl,
			) as GameState['players'],
		}
		expect(canComplete(s, 0, 0)).toBe(false)
		expect(completableMissions(s, 0)).toEqual([])
		const met = setSpecialty(s, 0, 'RESEARCH', 2)
		expect(canComplete(met, 0, 0)).toBe(true)
		expect(completableMissions(met, 0)).toEqual([0])
		const done = {
			...met,
			players: met.players.map((p) =>
				p.seat === 0
					? { ...p, missions: [{ ...p.missions[0]!, completed: true }] }
					: p,
			) as GameState['players'],
		}
		expect(canComplete(done, 0, 0)).toBe(false)
	})
})

describe('singleLegalAction (double-click fast path)', () => {
	it('returns the one legal PLAY op from the hand', () => {
		const s = setResources(board(), 0, 'DIL', 1)
		expect(singleLegalAction(s, 0, ID('p'))).toEqual({
			kind: 'PLAY',
			operationIndex: 0,
		})
	})

	it('returns the one legal ACTIVATION op on a deployed card', () => {
		const s = setSpecialty(board(), 0, 'MILITARY', 2)
		expect(singleLegalAction(s, 0, ID('v'))).toEqual({
			kind: 'ACTIVATION',
			operationIndex: 0,
		})
	})

	it('returns null when nothing is legal', () => {
		// The PLAY card needs RESEARCH 3 (board has 2); the ACTIVATION needs MILITARY 2.
		expect(singleLegalAction(board(), 0, ID('reqd'))).toBeNull()
		expect(singleLegalAction(board(), 0, ID('v'))).toBeNull()
	})

	it('returns null when more than one route is legal', () => {
		register([
			makeDef({
				id: 'dual',
				suit: 'PERSON',
				operations: [
					op('PLAY', GAIN('DIL')),
					op('PLAY', GAIN('LAT'), {
						requires: { specialty: 'RESEARCH', min: 0 },
					}),
				],
			}),
		])
		const s = setResources(
			place(fresh(), 'dual', ID('d'), { k: 'HAND', seat: 0 }, 0),
			0,
			'DIL',
			1,
		)
		expect(canPlay(s, 0, ID('d')).operations).toHaveLength(2)
		expect(singleLegalAction(s, 0, ID('d'))).toBeNull()
	})

	it('never mixes a PLAY and an ACTIVATION into a single action (hand vs in-play)', () => {
		// `p` is in the hand, so only its PLAY counts even though `v` (an
		// ACTIVATION) is in the same seat's fleet.
		const s = setSpecialty(setResources(board(), 0, 'DIL', 1), 0, 'MILITARY', 2)
		expect(singleLegalAction(s, 0, ID('p'))).toEqual({
			kind: 'PLAY',
			operationIndex: 0,
		})
		expect(singleLegalAction(s, 0, ID('v'))).toEqual({
			kind: 'ACTIVATION',
			operationIndex: 0,
		})
	})
})
