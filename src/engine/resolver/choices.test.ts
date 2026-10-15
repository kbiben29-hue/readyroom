// todo/07 — choice system (docs/state-machine.md §4/§5, todo/04 §10):
//   - the pure validateChoice gate rejects illegal selections with a reason
//     (unknown/stale choiceId, out-of-set card, disabled target, wrong amount
//     bounds, disabled option) without mutating state;
//   - applyChoice / reduce(RESOLVE_CHOICE) refuse illegal selections with the
//     typed IllegalSelectionError and leave the state byte-identical;
//   - UP_TO auto-resolve per todo/04 §10 (pure benefit → max, max 0 → 0,
//     benefit-with-downside → CHOOSE_AMOUNT halt + resume);
//   - every emitted choice carries seat (FORCE flips it) + sourceCard;
//   - a pending choice survives a JSON round-trip with all enabled/reason data
//     intact, and resumes identically.

import { describe, expect, it } from 'vitest'
import type { GameState, EffectCtx } from '../state'
import type { PendingChoice } from './choices'
import {
	applyChoice,
	validateChoice,
	checkSelection,
	IllegalSelectionError,
} from './choices'
import { resolveAmount } from './runtime'
import { run } from './stack'
import { reduce } from '../intents'
import { assertSerialisable } from '../invariants'
import {
	fresh,
	register,
	makeDef,
	place,
	pushAndRun,
	op,
	ID,
} from './testUtils'
import type { Effect } from './nodes'
import type { Frame } from '../state'

const CTX: EffectCtx = { actor: 0, source: ID('src'), bindings: {} }

/** Build a state whose single resumable frame is an EFFECT, so probe/
 *  applyChoice can store selections synthetically (overrides the real frame
 *  that produced a choice). */
function withPending(state: GameState, choice: PendingChoice): GameState {
	const frame: Frame = {
		k: 'EFFECT',
		node: { k: 'NOOP' } as Effect,
		ctx: CTX,
		ip: 0,
	}
	return { ...state, pendingChoice: choice, stack: [frame] }
}

/** A real halting CHOOSE_CARDS: DISMISS over two in-play SHIPs. */
function haltedChooseCards(): GameState {
	register([
		makeDef({ id: 'warship', suit: 'SHIP', operations: [] }),
		makeDef({
			id: 'strike',
			suit: 'PERSON',
			operations: [op('PLAY', { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 })],
		}),
	])
	let s = fresh()
	s = place(s, 'warship', ID('w0'), { k: 'FLEET', seat: 0 }, 0)
	s = place(s, 'warship', ID('w1'), { k: 'FLEET', seat: 0 }, 0)
	s = place(s, 'strike', ID('st'), { k: 'HAND', seat: 0 }, 0)
	const out = pushAndRun(
		s,
		{
			k: 'DISMISS',
			target: { zones: [{ k: 'FLEET', seat: 0 }], filter: { suits: ['SHIP'] } },
		},
		ID('st'),
		0,
	)
	const ch = out.pendingChoice
	if (ch === null || ch.k !== 'CHOOSE_CARDS')
		throw new Error('expected CHOOSE_CARDS')
	return out
}

describe('validateChoice — the pure gate', () => {
	it('rejects an unknown / stale choiceId', () => {
		const s = haltedChooseCards()
		const v = validateChoice(s, 'c999', ['w0'])
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.reason).toMatch(/choice id mismatch/)
		// the real id is accepted
		const pc = s.pendingChoice!
		if (pc.k !== 'CHOOSE_CARDS') throw new Error('expected CHOOSE_CARDS')
		const ok = validateChoice(s, pc.id, [pc.candidates[0]!])
		expect(ok.ok).toBe(true)
	})

	it('rejects when no choice is pending', () => {
		const v = validateChoice(fresh(), 'c1', [])
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.reason).toMatch(/no pending choice/)
	})

	it('rejects an out-of-set card', () => {
		const choice: PendingChoice = {
			k: 'CHOOSE_CARDS',
			id: 'c1',
			seat: 0,
			prompt: 'p',
			sourceCard: null,
			candidates: [ID('a'), ID('b')],
			min: 1,
			max: 1,
			from: 'HAND',
		}
		const s = withPending(fresh(), choice)
		const v = validateChoice(s, 'c1', [ID('x')])
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.reason).toMatch(/not a candidate/)
	})

	it('rejects a card the resolver marked disabled (not where its enabled flag claims)', () => {
		const choice: PendingChoice = {
			k: 'CHOOSE_CARDS',
			id: 'c1',
			seat: 0,
			prompt: 'p',
			sourceCard: null,
			candidates: [ID('a'), ID('b')],
			disabled: [
				{ iid: ID('b'), reason: 'WILDCARD is not a legal target here' },
			],
			min: 1,
			max: 1,
			from: 'IN_PLAY',
		}
		const s = withPending(fresh(), choice)
		const v = validateChoice(s, 'c1', [ID('b')])
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.reason).toMatch(/not a legal target/)
		// the non-disabled candidate remains legal
		expect(validateChoice(s, 'c1', [ID('a')]).ok).toBe(true)
	})

	it('rejects duplicate selections in CHOOSE_CARDS', () => {
		const choice: PendingChoice = {
			k: 'CHOOSE_CARDS',
			id: 'c1',
			seat: 0,
			prompt: 'p',
			sourceCard: null,
			candidates: [ID('a'), ID('b')],
			min: 2,
			max: 2,
			from: 'HAND',
		}
		const v = validateChoice(withPending(fresh(), choice), 'c1', [
			ID('a'),
			ID('a'),
		])
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.reason).toMatch(/duplicate/)
	})

	it('rejects amount selections outside min..max and non-integers', () => {
		const choice: PendingChoice = {
			k: 'CHOOSE_AMOUNT',
			id: 'c1',
			seat: 0,
			prompt: 'p',
			sourceCard: null,
			min: 1,
			max: 5,
		}
		const s = withPending(fresh(), choice)
		expect(validateChoice(s, 'c1', 0).ok).toBe(false)
		expect(validateChoice(s, 'c1', 6).ok).toBe(false)
		expect(validateChoice(s, 'c1', 2.5).ok).toBe(false)
		expect(validateChoice(s, 'c1', '3').ok).toBe(false)
		const ok = validateChoice(s, 'c1', 3)
		expect(ok.ok).toBe(true)
	})

	it('rejects a disabled CHOOSE_OPTION option', () => {
		const choice: PendingChoice = {
			k: 'CHOOSE_OPTION',
			id: 'c1',
			seat: 0,
			prompt: 'p',
			sourceCard: null,
			options: [
				{
					key: '0',
					label: 'gain nothing',
					enabled: false,
					reason: 'cannot fully resolve',
				},
				{ key: '1', label: 'gain an ALLY', enabled: true },
			],
		}
		const s = withPending(fresh(), choice)
		const v = validateChoice(s, 'c1', { key: '0' })
		expect(v.ok).toBe(false)
		if (!v.ok) expect(v.reason).toMatch(/not enabled/)
		expect(validateChoice(s, 'c1', { key: '1' }).ok).toBe(true)
		expect(validateChoice(s, 'c1', { key: 'nope' }).ok).toBe(false) // unknown option
	})

	it('checkSelection accepts every legal shape and rejects malformed ones', () => {
		expect(
			checkSelection(
				{ k: 'CONFIRM', id: 'c', seat: 0, prompt: 'p', sourceCard: null },
				true,
			).ok,
		).toBe(true)
		expect(
			checkSelection(
				{ k: 'CONFIRM', id: 'c', seat: 0, prompt: 'p', sourceCard: null },
				'yes',
			).ok,
		).toBe(false)
		const wild: PendingChoice = {
			k: 'CHOOSE_WILDCARD_AS',
			id: 'c',
			seat: 0,
			prompt: 'p',
			sourceCard: null,
			card: ID('w'),
			traits: ['VULCAN', 'KLINGON'],
		}
		expect(checkSelection(wild, 'VULCAN').ok).toBe(true)
		expect(checkSelection(wild, 'BAJORAN').ok).toBe(false)
		const dest: PendingChoice = {
			k: 'CHOOSE_DESTINATION',
			id: 'c',
			seat: 0,
			prompt: 'p',
			sourceCard: null,
			card: ID('g'),
			options: ['DECK_TOP', 'DISCARD'],
		}
		expect(checkSelection(dest, 'DISCARD').ok).toBe(true)
		expect(checkSelection(dest, 'BOX').ok).toBe(false)
	})
})

describe('illegal RESOLVE_CHOICE is rejected and leaves state unchanged', () => {
	it('applyChoice throws IllegalSelectionError before any mutation', () => {
		const s = haltedChooseCards()
		const before = JSON.stringify(s)
		const ch = s.pendingChoice!
		expect(() =>
			applyChoice(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch.id,
				selection: [ID('not-a-card')],
			}),
		).toThrow(IllegalSelectionError)
		expect(JSON.stringify(s)).toBe(before)
	})

	it('reduce rejects an illegal RESOLVE_CHOICE with a reason and no mutation', () => {
		const s = haltedChooseCards()
		const before = JSON.stringify(s)
		const ch = s.pendingChoice!
		let caught: unknown
		try {
			reduce(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch.id,
				selection: [ID('not-a-card')],
			})
		} catch (e) {
			caught = e
		}
		expect(caught).toBeInstanceOf(IllegalSelectionError)
		expect(JSON.stringify(s)).toBe(before)
	})

	it('reduce rejects a stale choiceId', () => {
		const s = haltedChooseCards()
		const before = JSON.stringify(s)
		expect(() =>
			reduce(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: 'stale',
				selection: [ID('w0')],
			}),
		).toThrow(IllegalSelectionError)
		expect(JSON.stringify(s)).toBe(before)
	})

	it('a legal RESOLVE_CHOICE still resumes to completion', () => {
		const s = haltedChooseCards()
		const ch = s.pendingChoice!
		if (ch.k !== 'CHOOSE_CARDS') throw new Error('expected CHOOSE_CARDS')
		const out = run(
			applyChoice(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch.id,
				selection: [ch.candidates[0]!],
			}),
		)
		expect(out.pendingChoice).toBeNull()
		expect(out.cards[ch.candidates[0]!]!.zone.k).toBe('DISCARD')
		assertSerialisable(out)
	})
})

describe('choice id determinism (todo/07 §1)', () => {
	it('the same (seed, script) replays to the same choice id across two fresh runs', () => {
		register([
			makeDef({ id: 'cargo', suit: 'CARGO', operations: [] }),
			makeDef({ id: 'ally', suit: 'ALLY', operations: [] }),
		])
		const build = () => {
			let s = fresh(7) // same seed
			s = place(s, 'cargo', ID('c1'), { k: 'MARKET_OFFER', suit: 'CARGO' })
			s = place(s, 'cargo', ID('c2'), { k: 'MARKET_OFFER', suit: 'CARGO' })
			s = place(s, 'ally', ID('a1'), { k: 'MARKET_OFFER', suit: 'ALLY' })
			s = place(s, 'ally', ID('a2'), { k: 'MARKET_OFFER', suit: 'ALLY' })
			return pushAndRun(s, { k: 'GAIN_CARD', suits: ['CARGO'] }, ID('src'), 0)
		}
		const run1 = build()
		const run2 = build()
		const c1 = run1.pendingChoice
		const c2 = run2.pendingChoice
		if (c1 === null || c2 === null) throw new Error('expected a pending choice')
		expect(c1.id).toBe(c2.id) // replay-stable, not a live counter
		// and it survives a mid-choice JSON round-trip byte-for-byte
		expect(
			(JSON.parse(JSON.stringify(run1)) as GameState).pendingChoice?.id,
		).toBe(c1.id)
	})
})

describe('UP_TO auto-resolve (todo/04 §10, todo/07 §2)', () => {
	it('a pure benefit resolves to max without halting', () => {
		const out = pushAndRun(
			fresh(),
			{ k: 'GAIN_RESOURCE', res: 'LAT', amount: { k: 'UP_TO', max: 3 } },
			ID('src'),
			0,
		)
		expect(out.pendingChoice).toBeNull()
		expect(out.players[0]!.resources.LAT).toBe(3)
	})

	it('UP_TO with max 0 resolves to 0 without halting (no pointless 0..0 prompt)', () => {
		const out = pushAndRun(
			fresh(),
			{ k: 'GAIN_RESOURCE', res: 'LAT', amount: { k: 'UP_TO', max: 0 } },
			ID('src'),
			0,
		)
		expect(out.pendingChoice).toBeNull()
		expect(out.players[0]!.resources.LAT).toBe(0)
	})

	it('a benefit with a downside halts with CHOOSE_AMOUNT and resumes to the chosen amount', () => {
		const s = fresh()
		const r = resolveAmount(s, { k: 'NOOP' } as Effect, CTX, 'amt', {
			prompt: 'Spend how much?',
			amount: { k: 'UP_TO', max: 5 },
			pure: false, // "spend up to X to gain X" — the player must weigh it
		})
		expect(r.kind).toBe('suspended')
		if (r.kind !== 'suspended') throw new Error('expected suspension')
		const halted = r.state
		expect(halted.pendingChoice?.k).toBe('CHOOSE_AMOUNT')
		const choice = halted.pendingChoice
		if (choice === null || choice.k !== 'CHOOSE_AMOUNT')
			throw new Error('expected CHOOSE_AMOUNT')
		expect(choice.min).toBe(0)
		expect(choice.max).toBe(5)
		expect(choice.seat).toBe(0)
		expect(choice.sourceCard).toBe(ID('src'))

		const resumed = applyChoice(halted, {
			t: 'RESOLVE_CHOICE',
			choiceId: choice.id,
			selection: 2,
		})
		expect(resumed.pendingChoice).toBeNull()
		const top = resumed.stack[resumed.stack.length - 1]
		if (top === undefined || top.k !== 'EFFECT')
			throw new Error('expected a resumable EFFECT frame')
		// the answered amount lands in the resume frame's bindings for the
		// primitive to read back on re-entry.
		expect(top.ctx.bindings['amt']).toBe(choice.id)
		expect(top.ctx.bindings[choice.id]).toBe(2)
	})
})

describe('choice seat under FORCE (rules/12 §12.14) + sourceCard', () => {
	it('a normal DISMISS emits seat = the active player and the striking card as sourceCard', () => {
		const s = haltedChooseCards()
		const ch = s.pendingChoice
		if (ch === null || ch.k !== 'CHOOSE_CARDS')
			throw new Error('expected CHOOSE_CARDS')
		expect(ch.seat).toBe(0)
		expect(ch.sourceCard).toBe(ID('st'))
	})

	it('FORCE flips the choice seat to the opponent, carried by the Choice', () => {
		register([
			makeDef({ id: 'warship', suit: 'SHIP', operations: [] }),
			makeDef({
				id: 'threat',
				suit: 'PERSON',
				operations: [
					op('PLAY', {
						k: 'OPPONENT',
						body: {
							k: 'SEQ',
							steps: [
								{
									k: 'DISMISS',
									target: {
										zones: [{ k: 'FLEET', seat: 0 }],
										seat: 'SELF',
										filter: { suits: ['SHIP'] },
									},
								},
							],
						},
					}),
				],
			}),
		])
		let s = fresh()
		s = place(s, 'warship', ID('w0'), { k: 'FLEET', seat: 1 }, 1)
		s = place(s, 'warship', ID('w1'), { k: 'FLEET', seat: 1 }, 1)
		s = place(s, 'threat', ID('th'), { k: 'HAND', seat: 0 }, 0)
		const out = pushAndRun(
			s,
			{
				k: 'FORCE',
				body: {
					k: 'DISMISS',
					target: {
						zones: [{ k: 'FLEET', seat: 0 }],
						seat: 'SELF',
						filter: { suits: ['SHIP'] },
					},
				},
			},
			ID('th'),
			0,
		)
		const ch = out.pendingChoice
		if (ch === null || ch.k !== 'CHOOSE_CARDS')
			throw new Error('expected CHOOSE_CARDS')
		expect(ch.seat).toBe(1) // the opponent decides
		expect(ch.sourceCard).toBe(ID('th')) // the forcing card
	})
})

describe('pending choices survive a JSON round-trip', () => {
	it('real CHOOSE_OPTION with enabled/reason survives mid-choice serialisation', () => {
		register([
			makeDef({ id: 'cargo', suit: 'CARGO', operations: [] }),
			makeDef({ id: 'ally', suit: 'ALLY', operations: [] }),
		])
		let s = fresh()
		s = place(s, 'ally', ID('a'), { k: 'MARKET_OFFER', suit: 'ALLY' })
		const node: Effect = {
			k: 'CHOOSE_ONE',
			options: [
				{ label: 'gain a CARGO', body: { k: 'GAIN_CARD', suits: ['CARGO'] } },
				{ label: 'gain an ALLY', body: { k: 'GAIN_CARD', suits: ['ALLY'] } },
			],
		}
		const halted = pushAndRun(s, node, ID('src'), 0)
		const ch = halted.pendingChoice
		if (ch === null || ch.k !== 'CHOOSE_OPTION')
			throw new Error('expected CHOOSE_OPTION')
		expect(ch.options[0]!.enabled).toBe(false)
		expect(ch.options[0]!.reason).toBeTruthy()
		expect(ch.options[1]!.enabled).toBe(true)

		const rt = JSON.parse(JSON.stringify(halted)) as GameState
		expect(rt.pendingChoice).not.toBeNull()
		const rch: PendingChoice = rt.pendingChoice as PendingChoice
		if (rch.k !== 'CHOOSE_OPTION') throw new Error('expected CHOOSE_OPTION')
		expect(rch.seat).toBe(ch.seat)
		expect(rch.sourceCard).toBe(ch.sourceCard)
		expect(rch.options).toEqual(ch.options) // enabled + reason intact
		// resumes identically from the deserialised state
		const fromOriginal = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: ch.id,
				selection: { key: '1' },
			}),
		)
		const fromRt = run(
			applyChoice(rt, {
				t: 'RESOLVE_CHOICE',
				choiceId: rch.id,
				selection: { key: '1' },
			}),
		)
		expect(fromRT_serialisable(fromRt)).toEqual(
			fromRT_serialisable(fromOriginal),
		)
	})

	it('a CHOOSE_CARDS with disabled entries keeps every candidate + reason', () => {
		const choice: PendingChoice = {
			k: 'CHOOSE_CARDS',
			id: 'c1',
			seat: 0,
			prompt: 'p',
			sourceCard: ID('st'),
			candidates: [ID('a'), ID('b'), ID('c')],
			disabled: [{ iid: ID('c'), reason: 'not a legal dismissal target' }],
			min: 1,
			max: 2,
			from: 'IN_PLAY',
			optional: true,
		}
		const s = withPending(fresh(), choice)
		const rt = JSON.parse(JSON.stringify(s)) as GameState
		const rch: PendingChoice = rt.pendingChoice as PendingChoice
		if (rch.k !== 'CHOOSE_CARDS') throw new Error('expected CHOOSE_CARDS')
		expect(rch).toEqual(choice)
		expect(rch.disabled).toEqual(choice.disabled)
		// validation still respects the disabled list after the round-trip
		expect(validateChoice(rt, 'c1', [ID('c')]).ok).toBe(false)
		expect(validateChoice(rt, 'c1', [ID('a')]).ok).toBe(true)
	})
})

function fromRT_serialisable(s: GameState): GameState {
	assertSerialisable(s)
	return s
}
