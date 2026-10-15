// §4 loop-guard + REPEAT semantics (todo/04 §3/§4):
//   - a malformed REPEAT (negative or non-integer count) throws a CLEAR error,
//     it never hangs;
//   - the run-loop hard cap throws a stack dump on a runaway;
//   - a legal REPEAT expands exactly `times` times.

import { describe, expect, it } from 'vitest'
import { registerScript } from './script'
import { pushEffect, run } from '../stack'
import { applyChoice, type PendingChoice } from '../choices'
import { zoneKey, type GameState } from '../../state'
import type { Effect } from '../nodes'
import type { Seat } from '../queries'
import {
	fresh,
	register,
	makeDef,
	place,
	ID,
	setResources,
	pushAndRun,
} from '../testUtils'

describe('REPEAT (malformed-card guard, todo/04 §4)', () => {
	it('negative times throws a clear error — not a hang', () => {
		const s = fresh()
		expect(() =>
			pushAndRun(
				s,
				{ k: 'REPEAT', times: -1, body: { k: 'NOOP' } },
				ID('src'),
				0,
			),
		).toThrow(/REPEAT: times must be a non-negative integer/)
	})

	it('non-integer times throws a clear error', () => {
		const s = fresh()
		expect(() =>
			pushAndRun(
				s,
				{ k: 'REPEAT', times: 1.5, body: { k: 'NOOP' } },
				ID('src'),
				0,
			),
		).toThrow(/times must be a non-negative integer/)
	})

	it('an oversized REPEAT (beyond the per-node cap) throws, not a hang', () => {
		const s = fresh()
		expect(() =>
			pushAndRun(
				s,
				{ k: 'REPEAT', times: 100_000, body: { k: 'NOOP' } },
				ID('src'),
				0,
			),
		).toThrow(/exceeds cap 500/)
	})

	it('a legal REPEAT expands the body exactly `times` times', () => {
		let s = setResources(fresh(), 0, 'DIL', 0)
		s = pushAndRun(
			s,
			{
				k: 'REPEAT',
				times: 3,
				body: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
			},
			ID('src'),
			0,
		)
		expect(s.players[0]!.resources.DIL).toBe(3)
	})
})

describe('run-loop hard cap (stack dump)', () => {
	it('throws a clear error mentioning the cap and the stack', () => {
		const s = fresh()
		registerScript('__repeat.test.self', {
			canResolve: () => true,
			execute: (st, node, ctx) => ({
				...st,
				stack: [...st.stack, { k: 'EFFECT', node, ctx, ip: 0 }],
			}),
		})
		const state: import('../../state').GameState = pushEffect(
			s,
			{ k: 'SCRIPT', fn: '__repeat.test.self' },
			{ actor: 0, source: ID('src'), bindings: {} },
		)
		try {
			run(state)
			expect('unreachable').toBe('run should have thrown')
		} catch (err) {
			expect(String(err)).toMatch(/exceeded 10000 steps/)
			expect(String(err)).toContain('SCRIPT')
		}
	})
})

// Regression: a REPEAT whose body suspends (a COST_DISCARD + SEND_AWAY_TEAM,
// the SET A COURSE shape) must re-ask its own choices AND re-pay its own cost
// on every iteration. Before the bindings-scope fix, one iteration's answers
// leaked into the next (the stack shares one ctx object across control nodes,
// and storeSelection rewrites answers onto every frame sharing that ctx), so
// iterations 2..N silently reused the destination and skipped the discard
// cost — one discard placed three away teams.

const mk2 = (
	id: string,
	suit: Parameters<typeof makeDef>[0]['suit'],
): ReturnType<typeof makeDef> => makeDef({ id, suit, operations: [] })

it.each([[0], [1]] as const)(
	'REPEAT suspension: each iteration re-asks and re-pays (seat %i)',
	(actor) => {
		register([
			mk2('loc1', 'LOCATION'),
			mk2('loc2', 'LOCATION'),
			mk2('per1', 'PERSON'),
			mk2('per2', 'PERSON'),
			mk2('per3', 'PERSON'),
		])
		const base = fresh(7)
		const players = base.players.map((pl) =>
			pl.seat === actor ? { ...pl, awayTeamsInPool: 10 } : pl,
		) as [GameState['players'][0], GameState['players'][1]]
		let s = { ...base, players }
		const loc1 = ID('loc1')
		const loc2 = ID('loc2')
		const handKey = zoneKey({ k: 'HAND', seat: actor as Seat })
		s = place(
			s,
			'loc1',
			loc1,
			{ k: 'LOCATION_AREA', seat: actor as Seat },
			actor,
		)
		s = place(
			s,
			'loc2',
			loc2,
			{ k: 'LOCATION_AREA', seat: actor as Seat },
			actor,
		)
		s = place(s, 'per1', ID('p1'), { k: 'HAND', seat: actor as Seat }, actor)
		s = place(s, 'per2', ID('p2'), { k: 'HAND', seat: actor as Seat }, actor)
		s = place(s, 'per3', ID('p3'), { k: 'HAND', seat: actor as Seat }, actor)

		const node: Effect = {
			k: 'REPEAT',
			times: 2,
			body: {
				k: 'PAY_THEN',
				cost: { k: 'COST_DISCARD', count: 1, filter: { suits: ['PERSON'] } },
				body: {
					k: 'SEND_AWAY_TEAM',
					count: 1,
					target: {
						zones: [{ k: 'LOCATION_AREA', seat: 0 }],
						filter: { suits: ['LOCATION'] },
					},
				},
			},
		}
		s = pushAndRun(s, node, ID('src'), actor)

		// Iteration 1: fresh CHOOSE_CARDS + CHOOSE_LOCATION.
		expect(s.pendingChoice?.k).toBe('CHOOSE_CARDS')
		s = applyChoice(s, {
			t: 'RESOLVE_CHOICE',
			choiceId: s.pendingChoice!.id,
			selection: [ID('p1')],
		})
		s = run(s)
		expect(s.pendingChoice?.k).toBe('CHOOSE_LOCATION')
		s = applyChoice(s, {
			t: 'RESOLVE_CHOICE',
			choiceId: s.pendingChoice!.id,
			selection: loc1,
		})
		s = run(s)

		// Iteration 2 MUST prompt again — the leak reused the first answers and
		// silently sent without asking (and paid no second cost).
		expect(s.pendingChoice?.k, 'iteration 2 must re-ask its discard').toBe(
			'CHOOSE_CARDS',
		)
		expect(
			(s.pendingChoice as PendingChoice & { candidates: string[] }).candidates,
		).toHaveLength(2)
		s = applyChoice(s, {
			t: 'RESOLVE_CHOICE',
			choiceId: s.pendingChoice!.id,
			selection: [ID('p2')],
		})
		s = run(s)
		expect(s.pendingChoice?.k).toBe('CHOOSE_LOCATION')
		s = applyChoice(s, {
			t: 'RESOLVE_CHOICE',
			choiceId: s.pendingChoice!.id,
			selection: loc2,
		})
		s = run(s)

		// Both costs paid, both sends placed (to DIFFERENT locations — iteration 2
		// could re-choose), totals preserved.
		expect(s.pendingChoice).toBeNull()
		expect(s.awayTeamsAt[loc1]?.[actor] ?? 0).toBe(1)
		expect(s.awayTeamsAt[loc2]?.[actor] ?? 0).toBe(1)
		expect(s.players[actor]!.awayTeamsInPool).toBe(8)
		expect(s.zones[handKey]!.map((i) => s.cards[i]!.def)).toEqual(['per3'])
		expect(
			s.zones[zoneKey({ k: 'DISCARD', seat: actor as Seat })]!.map(
				(i) => s.cards[i]!.def,
			).sort(),
		).toEqual(['per1', 'per2'])
		const total =
			s.players[actor]!.awayTeamsInPool +
			Object.values(s.awayTeamsAt).reduce((a, x) => a + (x[actor] ?? 0), 0)
		expect(total).toBe(10)
	},
)
