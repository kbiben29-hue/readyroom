// todo/06 §2.5 + DoD — the intent layer on top of the phase machine:
//   - a full fixture PIC-vs-SHR turn driven by a scripted intent
//     sequence (START → Action play → END_TURN → clean-up choices) with
//     phase-boundary assertions (rules/03 §3.3 → §3.6);
//   - illegal intents throw (legalIntents/reduce never offer them);
//   - determinism: same seed + same intent log → byte-identical state, and
//     assertSerialisable after every operation.

import { describe, expect, it } from 'vitest'
import { reduce, legalIntents, type Intent } from './intents'
import type { GameState } from './state'
import { newGameState, addCard, zoneKey, player } from './state'
import { registerCards } from './cards'
import { assertSerialisable } from './invariants'
import { setup } from './setup'
import type { SetupConfig } from './setup'
import { picShrCatalog, picShrConfig, mk, op, gain } from './todo06Fixture'
import { canPlay } from './queries/legality'
import type { CardInstanceId } from './ids'

const catalog = picShrCatalog()

describe('whole turn via intents (rules/03)', () => {
	it('START → Action play → END_TURN → clean-up → next player at ACTION', () => {
		// seed 4: the starting player is PIC (seat 0) with pic-av-01 in hand.
		const cfg: SetupConfig = { ...picShrConfig, seed: 4 }
		let s = setup(cfg, catalog)
		expect(s.phase).toEqual({ k: 'SETUP' })
		expect(s.startingSeat).toBe(0)

		// --- Setup -> first turn (SETUP → RESUPPLY → CONTROL → ACTION) ---
		let r = reduce(s, { t: 'START' })
		s = r.state
		assertSerialisable(s)
		expect(s.phase.k).toBe('ACTION')
		expect(s.activeSeat).toBe(0)
		expect(s.turnNumber).toBe(1)
		expect(s.turnsTaken).toEqual([0, 0])

		// --- Action: play pic-av-01 (PLAY → gain 1 DIL) ---
		const hand = s.zones[zoneKey({ k: 'HAND', seat: 0 })] ?? []
		const target = hand.find((iid) => s.cards[iid]!.def === 'pic-av-01')!
		expect(target).toBeDefined()
		const check = canPlay(s, 0, target!)
		expect(check.ok).toBe(true)
		expect(check.operations).toContain(0)

		r = reduce(s, { t: 'PLAY_CARD', iid: target!, operationIndex: 0 })
		s = r.state
		assertSerialisable(s)
		expect(s.cards[target!]!.zone).toEqual({ k: 'STAGING', seat: 0 }) // staged first (§3.5.4)
		expect(player(s, 0).resources.DIL).toBe(2) // 1 from setup + 1 from the PLAY op
		expect(r.events.map((e) => e.k)).toEqual(
			expect.arrayContaining([
				'RESOURCE_GAINED',
				'CARD_PLAYED',
				'PUT_INTO_PLAY',
			]),
		)
		expect(s.phase.k).toBe('ACTION') // still the same Action step

		// --- End the Action step -> CLEAN-UP (rules/03 §3.6) ---
		r = reduce(s, { t: 'END_TURN' })
		s = r.state
		expect(s.phase).toEqual({ k: 'CLEANUP', sub: 'GLORY_PLACEMENT' })
		expect(s.pendingChoice?.k).toBe('CHOOSE_CARDS') // place 1 Glory on a Market card
		const gloryChoice = s.pendingChoice!
		const marketPick = (gloryChoice as { candidates: CardInstanceId[] })
			.candidates[0]!
		r = reduce(s, {
			t: 'RESOLVE_CHOICE',
			choiceId: gloryChoice.id,
			selection: [marketPick],
		})
		s = r.state
		assertSerialisable(s)
		expect(s.stardates.gloryOnTop).toBe(4) // sd-001 prints 5, one moved to the Market
		expect(s.cards[marketPick]!.resourceTokens.GLO).toBe(1)

		// --- voluntary hand discard ---
		expect(s.pendingChoice?.k).toBe('CHOOSE_CARDS') // hand is 4, min 0 max 4
		const discardChoice = s.pendingChoice!
		r = reduce(s, {
			t: 'RESOLVE_CHOICE',
			choiceId: discardChoice.id,
			selection: [],
		})
		s = r.state
		assertSerialisable(s)

		// --- clean-up finished -> handoff to the next player, correct phase ---
		expect(s.phase.k).toBe('ACTION')
		expect(s.activeSeat).toBe(1)
		expect(s.turnNumber).toBe(2)
		expect(s.turnsTaken).toEqual([1, 0])
		expect(s.cards[target!]!.zone).toEqual({ k: 'DISCARD', seat: 0 }) // staging → discard
		expect((s.zones[zoneKey({ k: 'HAND', seat: 0 })] ?? []).length).toBe(5) // drawn back to hand size
		// the next player's own hand is theirs (5 cards from setup)
		expect((s.zones[zoneKey({ k: 'HAND', seat: 1 })] ?? []).length).toBe(5)
	})
})

describe('illegal intents throw (the UI only sends legalIntents)', () => {
	const cfg: SetupConfig = { ...picShrConfig, seed: 4 }
	const setupState = setup(cfg, catalog)

	it('PLAY_CARD during SETUP throws', () => {
		expect(() =>
			reduce(setupState, {
				t: 'PLAY_CARD',
				iid: 'pic#0000' as CardInstanceId,
				operationIndex: 0,
			}),
		).toThrow(/not legal in phase SETUP/)
	})

	it('START twice throws (already past SETUP)', () => {
		const started = reduce(setupState, { t: 'START' }).state
		expect(() => reduce(started, { t: 'START' })).toThrow(
			/not legal in phase ACTION/,
		)
	})

	it('END_TURN outside the Action step throws', () => {
		// a CONTROL-phase state (bare, no secured auto-advances; we force CONTROL)
		const ctrl: GameState = {
			...newGameState(1),
			phase: { k: 'CONTROL' },
			activeSeat: 0,
		}
		expect(() => reduce(ctrl, { t: 'END_TURN' })).toThrow(
			/not legal in phase CONTROL/,
		)
	})

	it('RESOLVE_CHOICE with no pending choice throws', () => {
		const started = reduce(setupState, { t: 'START' }).state
		expect(() =>
			reduce(started, { t: 'RESOLVE_CHOICE', choiceId: 'c1', selection: [] }),
		).toThrow(/no pending choice/)
	})

	it('PLAY_CARD for a card not in the active player’s hand throws', () => {
		const s = reduce(setupState, { t: 'START' }).state
		const opponentCard = (s.zones[zoneKey({ k: 'HAND', seat: 1 })] ?? [])[0]!
		expect(() =>
			reduce(s, { t: 'PLAY_CARD', iid: opponentCard, operationIndex: 0 }),
		).toThrow(/not in 0's hand/)
	})

	it('PLAY_CARD with a non-PLAY operation index throws', () => {
		const s = reduce(setupState, { t: 'START' }).state
		const target = (s.zones[zoneKey({ k: 'HAND', seat: 0 })] ?? []).find(
			(i) => s.cards[i]!.def === 'pic-av-01',
		)!
		expect(() =>
			reduce(s, { t: 'PLAY_CARD', iid: target, operationIndex: 9 }),
		).toThrow(/not a PLAY operation|not playable/)
	})

	it('ACTIVATE a card that is not in play throws', () => {
		const s = reduce(setupState, { t: 'START' }).state
		const handCard = (s.zones[zoneKey({ k: 'HAND', seat: 0 })] ?? [])[0]!
		expect(() =>
			reduce(s, { t: 'ACTIVATE', iid: handCard, operationIndex: 0 }),
		).toThrow()
	})
})

describe('ACTIVATE (rules/03 §3.5.5)', () => {
	it('exhausts the card, pays the action cost and runs the activation', () => {
		registerCards([
			mk({
				id: 'nav-console',
				suit: 'SHIP',
				operations: [op('ACTIVATION', gain('GLO'), true)],
			}),
		])
		let s: GameState = newGameState(1)
		s = addCard(s, 'nav1' as CardInstanceId, 'nav-console', 0, {
			k: 'FLEET',
			seat: 0,
		})
		s = {
			...s,
			phase: { k: 'ACTION' },
			activeSeat: 0,
			players: [
				{ ...s.players[0], actions: { available: 3, spent: 0 } },
				s.players[1],
			] as GameState['players'],
		}
		const r = reduce(s, {
			t: 'ACTIVATE',
			iid: 'nav1' as CardInstanceId,
			operationIndex: 0,
		})
		s = r.state
		assertSerialisable(s)
		expect(s.cards['nav1']!.exhausted).toBe(true) // exhausted as the reminder (§3.5.5)
		expect(player(s, 0).actions).toEqual({ available: 2, spent: 1 }) // the paid action moves to spent
		expect(player(s, 0).resources.GLO).toBe(1)
		expect(r.events.map((e) => e.k)).toEqual(
			expect.arrayContaining(['ACTION_SPENT', 'RESOURCE_GAINED']),
		)
		// an exhausted card cannot be activated again
		expect(() =>
			reduce(s, {
				t: 'ACTIVATE',
				iid: 'nav1' as CardInstanceId,
				operationIndex: 0,
			}),
		).toThrow(/exhausted/)
	})

	it('a costsAction activation is illegal when no action is available', () => {
		registerCards([
			mk({
				id: 'console2',
				suit: 'SHIP',
				operations: [op('ACTIVATION', gain('LAT'), true)],
			}),
		])
		let s: GameState = newGameState(1)
		s = addCard(s, 'nav2' as CardInstanceId, 'console2', 0, {
			k: 'FLEET',
			seat: 0,
		})
		s = {
			...s,
			phase: { k: 'ACTION' },
			activeSeat: 0,
			players: [
				{ ...s.players[0], actions: { available: 0, spent: 0 } },
				s.players[1],
			] as GameState['players'],
		}
		expect(() =>
			reduce(s, {
				t: 'ACTIVATE',
				iid: 'nav2' as CardInstanceId,
				operationIndex: 0,
			}),
		).toThrow(/action|resolv/i)
	})
})

describe('event gating on the PLAY outcome (rules/08 → put into play: after)', () => {
	it('a card that logs itself emits CARD_PLAYED but NOT PUT_INTO_PLAY', () => {
		registerCards([
			mk({
				id: 'self-log',
				suit: 'PERSON',
				operations: [op('PLAY', { k: 'LOG', target: 'THIS' })],
			}),
		])
		let s: GameState = newGameState(1)
		s = addCard(s, 'log1' as CardInstanceId, 'self-log', 0, {
			k: 'HAND',
			seat: 0,
		})
		s = { ...s, phase: { k: 'ACTION' }, activeSeat: 0 }
		const r = reduce(s, {
			t: 'PLAY_CARD',
			iid: 'log1' as CardInstanceId,
			operationIndex: 0,
		})
		s = r.state
		expect(s.cards['log1']!.zone).toEqual({ k: 'LOG', seat: 0 })
		expect(r.events.map((e) => e.k)).toContain('CARD_LOGGED' as never)
		expect(r.events.map((e) => e.k)).toContain('CARD_PLAYED' as never)
		expect(r.events.map((e) => e.k)).not.toContain('PUT_INTO_PLAY' as never)
	})
})

describe('determinism (DoD)', () => {
	/** Record every intent dispatched while driving a full turn, replay it on a
	 *  fresh state, and require byte-identical results. */
	function drive(state: GameState, intents: Intent[]): GameState {
		for (const intent of intents) {
			const r = reduce(state, intent)
			state = r.state
			assertSerialisable(state) // serialisable after every operation
		}
		return state
	}

	const logFor = (seed: number): Intent[] => {
		const s = setup({ ...picShrConfig, seed }, catalog)
		const log: Intent[] = []
		let st = s
		const step = (i: Intent): void => {
			log.push(i)
			st = reduce(st, i).state
		}
		step({ t: 'START' })
		const hand = st.zones[zoneKey({ k: 'HAND', seat: st.activeSeat })] ?? []
		const playable = hand.find((iid) => canPlay(st, st.activeSeat, iid).ok)
		if (playable) step({ t: 'PLAY_CARD', iid: playable, operationIndex: 0 })
		step({ t: 'END_TURN' })
		let guard = 0
		while (st.pendingChoice && guard++ < 8) {
			const ch = st.pendingChoice
			const sel =
				ch.k === 'CHOOSE_CARDS'
					? ch.candidates.slice(0, ch.min)
					: 'candidates' in ch
						? (ch.candidates[0] ?? null)
						: null
			step({ t: 'RESOLVE_CHOICE', choiceId: ch.id, selection: sel })
		}
		return log
	}

	it('same seed + same intent log → byte-identical serialised state', () => {
		const log = logFor(4)
		expect(log.length).toBeGreaterThan(3) // START, END_TURN, glory + discard choices
		const a = setup({ ...picShrConfig, seed: 4 }, catalog)
		const b = setup({ ...picShrConfig, seed: 4 }, catalog)
		const outA = drive(a, log)
		const outB = drive(b, log)
		expect(outA).toEqual(outB)
		expect(JSON.stringify(outA)).toBe(JSON.stringify(outB))
		expect(outA.activeSeat).toBe(1)
		expect(outA.phase.k).toBe('ACTION')
		assertSerialisable(outA)
	})

	it('a different seed produces a different game (each replayed against its own seed)', () => {
		// Replaying seed 5's own log against seed 5 must be byte-identical to
		// itself, and must differ from seed 4's game.
		const a5 = drive(setup({ ...picShrConfig, seed: 5 }, catalog), logFor(5))
		const b5 = drive(setup({ ...picShrConfig, seed: 5 }, catalog), logFor(5))
		expect(JSON.stringify(a5)).toBe(JSON.stringify(b5))
		const a4 = drive(setup({ ...picShrConfig, seed: 4 }, catalog), logFor(4))
		expect(JSON.stringify(a4)).not.toBe(JSON.stringify(a5))
	})

	it('legalIntents exposes only what reduce accepts, in a stable order', () => {
		const started = reduce(setup({ ...picShrConfig, seed: 4 }, catalog), {
			t: 'START',
		}).state
		const intents = legalIntents(started)
		expect(intents.length).toBeGreaterThan(2)
		for (const i of intents) {
			expect(() => reduce(started, i)).not.toThrow() // reduce accepts everything it offers
		}
	})
})
