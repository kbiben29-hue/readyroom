// Stack-machine tests (todo/04 §3 + the DoD's core claim):
//   - run() halts on pendingChoice, resumes on RESOLVE_CHOICE via applyChoice;
//   - a mid-effect JSON round-trip produces byte-identical final states;
//   - executeOne advances EXACTLY ONE primitive (reaction-window invariant);
//   - a malformed REPEAT (negative count) throws a clear error, not a hang;
//   - the hard loop cap throws a stack dump on a runaway.

import { describe, expect, it } from 'vitest'

import type { GameState, EffectCtx } from '../state'
import type { Effect } from './nodes'
import { run, executeOne, pushEffect } from './stack'
import { applyChoice } from './choices'
import { registerScript } from './primitives/script'
import { assertSerialisable } from '../invariants'
import {
	fresh,
	register,
	makeDef,
	place,
	pushAndRun,
	play,
	op,
	ID,
	setResources,
} from './testUtils'
import type { CardInstanceId } from '../ids'

function ctxOf(actor: 0 | 1, source: CardInstanceId): EffectCtx {
	return { actor, source, bindings: {} }
}

describe('run: halt + resume', () => {
	it('halts when a pending choice appears; applyChoice + run resumes to completion', () => {
		const s0 = setResources(fresh(), 0, 'DIL', 0)
		// MAY → CONFIRM choice, then a pure benefit
		const state = pushAndRun(
			s0,
			{ k: 'MAY', body: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 5 } },
			ID('src'),
			0,
		)
		expect(state.pendingChoice).not.toBeNull()
		expect(state.pendingChoice?.k).toBe('CONFIRM')

		const choiceId = state.pendingChoice!.id
		const s2 = run(
			applyChoice(state, { t: 'RESOLVE_CHOICE', choiceId, selection: true }),
		)
		expect(s2.pendingChoice).toBeNull()
		expect(s2.stack).toHaveLength(0)
		expect(s2.players[0]!.resources.DIL).toBe(5)
	})

	it('resumes a choice that sits mid-sequence, not just at the end', () => {
		const s0 = setResources(fresh(), 0, 'LAT', 0)
		const node: Effect = {
			k: 'SEQ',
			steps: [
				{ k: 'MAY', body: { k: 'GAIN_RESOURCE', res: 'LAT', amount: 3 } },
				{ k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
			],
		}
		const s1 = pushAndRun(s0, node, ID('src'), 0)
		expect(s1.pendingChoice?.k).toBe('CONFIRM')
		const s2 = run(
			applyChoice(s1, {
				t: 'RESOLVE_CHOICE',
				choiceId: s1.pendingChoice!.id,
				selection: true,
			}),
		)
		expect(s2.players[0]!.resources).toEqual({ DIL: 1, LAT: 3, GLO: 0 })
	})

	it('declining a MAY leaves no partial effects behind', () => {
		const s0 = setResources(fresh(), 0, 'DIL', 0)
		const s1 = pushAndRun(
			s0,
			{ k: 'MAY', body: { k: 'GAIN_RESOURCE', res: 'DIL', amount: 5 } },
			ID('src'),
			0,
		)
		const s2 = run(
			applyChoice(s1, {
				t: 'RESOLVE_CHOICE',
				choiceId: s1.pendingChoice!.id,
				selection: false,
			}),
		)
		expect(s2.players[0]!.resources.DIL).toBe(0)
	})
})

describe('executeOne advances exactly one primitive', () => {
	it('a three-step SEQ needs three executeOne calls (one benefit each step)', () => {
		const s0 = setResources(setResources(fresh(), 0, 'DIL', 0), 0, 'LAT', 0)
		const node: Effect = {
			k: 'SEQ',
			steps: [
				{ k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 },
				{ k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
				{ k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
			],
		}
		let s = pushEffect(s0, node, ctxOf(0, ID('src')))
		// executeOne #1 runs the SEQ control step only (pushes the step frame) —
		// one primitive per step, so the first benefit lands on the second call.
		s = executeOne(s)
		expect(s.players[0]!.resources.DIL).toBe(0)
		s = executeOne(s) // GAIN_RESOURCE DIL
		expect(s.players[0]!.resources.DIL).toBe(1)
		expect(s.players[0]!.resources.LAT).toBe(0)
		s = executeOne(s) // SEQ -> step 2
		s = executeOne(s) // GAIN_RESOURCE LAT
		expect(s.players[0]!.resources.LAT).toBe(1)
		expect(s.players[0]!.resources.GLO).toBe(0)
		s = executeOne(s) // SEQ -> step 3
		s = executeOne(s) // GAIN_RESOURCE GLO
		expect(s.players[0]!.resources.GLO).toBe(1)
		s = executeOne(s) // SEQ done
		expect(s.stack).toHaveLength(0)
	})
})

describe('mid-effect serialisation (DoD core claim)', () => {
	it('batch vs mid-effect JSON round-trip yield byte-identical final states', () => {
		register([
			makeDef({ id: 'cargo', suit: 'CARGO', operations: [] }),
			makeDef({ id: 'handcard', suit: 'PERSON', operations: [] }),
			makeDef({
				id: 'recruiter',
				suit: 'PERSON',
				operations: [
					op('PLAY', {
						k: 'SEQ',
						steps: [
							{ k: 'GAIN_CARD', suits: ['CARGO'] },
							{ k: 'GAIN_RESOURCE', res: 'DIL', amount: 2 },
							{ k: 'DISCARD', from: 'HAND', count: 1 },
							{ k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
						],
					}),
				],
			}),
		])

		const base = setResources(setResources(fresh(7), 0, 'DIL', 0), 0, 'LAT', 0)
		let s = place(base, 'cargo', ID('c1'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		s = place(s, 'cargo', ID('c2'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		s = place(s, 'handcard', ID('h1'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'handcard', ID('h2'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'handcard', ID('h3'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'recruiter', ID('rec'), { k: 'HAND', seat: 0 }, 0)

		// --- batch: all choices answered against the live in-memory state --------
		let batch = play(s, ID('rec'))
		const picks: Record<string, unknown>[] = []
		while (batch.pendingChoice !== null) {
			const c = batch.pendingChoice
			let sel: unknown
			if (c.k === 'CHOOSE_CARDS') sel = [c.candidates[0]!]
			else if (c.k === 'CHOOSE_DESTINATION') sel = c.options[0]!
			else throw new Error(`unexpected choice ${c.k}`)
			picks.push({ id: c.id, sel })
			batch = run(
				applyChoice(batch, {
					t: 'RESOLVE_CHOICE',
					choiceId: c.id,
					selection: sel,
				}),
			)
		}
		expect(picks.map((p) => (p as { id: string }).id)).toHaveLength(3)

		// --- round-trip: deep-clone the state while the first choice is pending ---
		let rt = play(s, ID('rec'))
		const first = rt.pendingChoice
		if (first === null || first.k !== 'CHOOSE_CARDS')
			throw new Error('expected a card gain choice')
		const midEffect = JSON.parse(JSON.stringify(rt)) as GameState
		// the mid-effect snapshot must still be serialisable and resume identically
		assertSerialisable(midEffect)
		rt = run(
			applyChoice(midEffect, {
				t: 'RESOLVE_CHOICE',
				choiceId: first.id,
				selection: [first.candidates[0]!],
			}),
		)
		while (rt.pendingChoice !== null) {
			const c = rt.pendingChoice
			const sel =
				c.k === 'CHOOSE_CARDS'
					? [c.candidates[0]!]
					: c.k === 'CHOOSE_DESTINATION'
						? c.options[0]!
						: null
			if (sel === null) throw new Error(`unexpected choice ${c.k}`)
			rt = run(
				applyChoice(rt, {
					t: 'RESOLVE_CHOICE',
					choiceId: c.id,
					selection: sel,
				}),
			)
		}

		expect(JSON.stringify(batch)).toBe(JSON.stringify(rt))
		// and both are genuinely serialisable JSON
		assertSerialisable(batch)
		assertSerialisable(rt)
	})
})

describe('loop guards', () => {
	it('a REPEAT with a negative count throws a clear error (not a hang)', () => {
		const s = fresh()
		expect(() =>
			pushAndRun(
				s,
				{ k: 'REPEAT', times: -1, body: { k: 'NOOP' } },
				ID('src'),
				0,
			),
		).toThrow(/REPEAT.*non-negative/)
	})

	it('a REPEAT count that is not an integer throws a clear error', () => {
		const s = fresh()
		expect(() =>
			pushAndRun(
				s,
				{ k: 'REPEAT', times: 2.5, body: { k: 'NOOP' } },
				ID('src'),
				0,
			),
		).toThrow(/REPEAT/)
	})

	it('a runaway script trips the hard loop cap and reports the stack', () => {
		// register a test-only handler that re-pushes itself forever
		const loopNode = { k: 'SCRIPT' as const, fn: '__stack.test.loop' }
		registerScript('__stack.test.loop', {
			canResolve: () => true,
			execute: (state, node, ctx) => ({
				...state,
				stack: [...state.stack, { k: 'EFFECT' as const, node, ctx, ip: 0 }],
			}),
		})
		const s = fresh()
		let state = pushEffect(s, loopNode, ctxOf(0, ID('src')))
		expect(() => run(state)).toThrow(/exceeded \d+ steps/)
		try {
			run(state)
		} catch (err) {
			expect(String(err)).toContain('SCRIPT')
			state = s
		}
	})
})
