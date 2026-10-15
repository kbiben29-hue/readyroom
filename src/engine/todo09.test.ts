// todo/09 — the event bus: PASSIVE ops and REACTION windows (docs/architecture
// §4, rules/08 → PASSIVE/REACTION, rules/12 §12.24–12.25, docs/state-machine §3).
//
// Tests every row of the todo/09 §1 emission table and the full Definition of
// Done: a REACTION interrupting a 3-step SEQ resumes at step 2; PASSIVEs apply
// on exhausted cards; REACTIONs don't; Staging cards can't react; a
// self-deploying card reacts to its own deployment; steal/take don't fire the
// gain triggers; a self-retriggering PASSIVE is caught by the loop guard;
// nested reaction chains (§12.24) work; two players' reactions are offered in
// a deterministic order (the event's player first, todo/09 §5).

import { describe, expect, it } from 'vitest'
import {
	fresh,
	register,
	makeDef,
	place,
	ID,
	op,
	setResources,
} from './resolver/testUtils'
import type { CardDef } from '../data/schema'
import { runCollecting } from './resolver/stack'
import { applyChoice, type PendingChoice } from './resolver/choices'
import { drainEvents, MAX_REACTION_DEPTH } from './resolver/triggers'
import { assertSerialisable } from './invariants'
import {
	moveCard,
	player,
	type GameState,
	type GameEvent,
	type Frame,
} from './state'
import type { CardInstanceId } from './ids'
import type { Effect } from './resolver/nodes'
import type { Seat } from './resolver/queries'

// ---------------------------------------------------------------------------
// Fixtures + drivers
// ---------------------------------------------------------------------------

const mk = (
	id: string,
	suit: Parameters<typeof makeDef>[0]['suit'],
	ops: Parameters<typeof makeDef>[0]['operations'] = [],
	traits: string[] = [],
): CardDef =>
	makeDef({
		id,
		suit,
		traits: traits as Parameters<typeof makeDef>[0]['traits'],
		operations: ops,
	})

const gain = (res: 'DIL' | 'LAT' | 'GLO', amount: number): Effect => ({
	k: 'GAIN_RESOURCE',
	res,
	amount,
})

type WindowSel = (c: PendingChoice) => unknown
const none: WindowSel = () => []
const want: WindowSel = (c) =>
	c.k === 'OPTIONAL_TRIGGERS' ? [c.offered[0]!] : firstPick(c)

/** Narrow a haltAtWindow result to an OPTIONAL_TRIGGERS window, failing the
 *  test loudly if some other choice (or completion) arrived instead. */
function mustTrigger(h: {
	window: PendingChoice | null
}): Extract<PendingChoice, { k: 'OPTIONAL_TRIGGERS' }> {
	if (!h.window || h.window.k !== 'OPTIONAL_TRIGGERS') {
		throw new Error(
			'expected an OPTIONAL_TRIGGERS window, got ' +
				(h.window ? h.window.k : 'none'),
		)
	}
	return h.window
}

function firstPick(c: PendingChoice): unknown {
	switch (c.k) {
		case 'CONFIRM':
			return true
		case 'CHOOSE_CARDS':
			return c.candidates.slice(0, c.min)
		case 'CHOOSE_LOCATION':
			return c.candidates[0]
		case 'CHOOSE_SUIT':
			return c.suits[0]
		case 'CHOOSE_TRAIT':
			return c.traits[0]
		case 'CHOOSE_SPECIALTY':
			return c.specialties[0] ?? 'RESEARCH'
		case 'CHOOSE_DESTINATION':
			return c.options[0] ?? 'DECK_TOP'
		case 'CHOOSE_AMOUNT':
			return c.max
		case 'ORDER_OPERATIONS':
			return c.pending
		case 'OPTIONAL_TRIGGERS':
			return c.offered
		case 'CHOOSE_WITNESS':
			return c.sets[0]
		case 'CHOOSE_WILDCARD_AS':
			return c.traits[0]
		case 'ORDER_CARDS':
			return c.cards
		case 'CHOOSE_OPTION': {
			const opt = c.options.find((o) => o.enabled) ?? c.options[0]!
			return { key: opt.key }
		}
	}
}

/** Drive to a halt, answering non-window choices automatically and handing
 *  every OPTIONAL_TRIGGERS window to `whenWindow` (returns the selection).
 *  Collects every drained event. */
function drive(
	state: GameState,
	whenWindow: WindowSel,
): { state: GameState; events: GameEvent[] } {
	let s = state
	const events: GameEvent[] = []
	let guard = 0
	while (
		s.result === null &&
		(s.pendingChoice !== null || s.stack.length > 0)
	) {
		if (++guard > 2000) throw new Error('drive: too many iterations')
		if (s.pendingChoice !== null) {
			const c = s.pendingChoice
			const sel = c.k === 'OPTIONAL_TRIGGERS' ? whenWindow(c) : firstPick(c)
			s = applyChoice(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: c.id,
				selection: sel,
			})
		}
		const r = runCollecting(s)
		s = r.state
		events.push(...r.events)
	}
	return { state: s, events }
}

/** Drive a pushed/effectless state until the FIRST OPTIONAL_TRIGGERS window
 *  opens (or completion). Windows are NOT answered here — the caller asserts
 *  on them and resumes via drive/applyChoice. */
function haltAtWindow(state: GameState): {
	state: GameState
	events: GameEvent[]
	window: PendingChoice | null
} {
	let s = state
	const events: GameEvent[] = []
	let guard = 0
	while (
		s.result === null &&
		(s.pendingChoice !== null || s.stack.length > 0)
	) {
		if (++guard > 2000) throw new Error('haltAtWindow: too many iterations')
		if (s.pendingChoice !== null) {
			const c = s.pendingChoice
			if (c.k === 'OPTIONAL_TRIGGERS') return { state: s, events, window: c }
			const sel = firstPick(c)
			s = applyChoice(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: c.id,
				selection: sel,
			})
		}
		const r = runCollecting(s)
		s = r.state
		events.push(...r.events)
	}
	return { state: s, events, window: null }
}

/** Drive a bare EFFECT frame from `source` for `actor` (no PLAY_ op casing). */
function effect(
	state: GameState,
	node: Effect,
	source: CardInstanceId,
	actor: Seat,
	whenWindow: WindowSel = none,
): { state: GameState; events: GameEvent[] } {
	const frame: Frame = {
		k: 'EFFECT',
		node,
		ctx: { actor, source, bindings: {} },
		ip: 0,
	}
	return drive({ ...state, stack: [...state.stack, frame] }, whenWindow)
}

/** Drive a bare EFFECT frame as far as the next window (or completion). */
function effectToWindow(
	state: GameState,
	node: Effect,
	source: CardInstanceId,
	actor: Seat,
) {
	const frame: Frame = {
		k: 'EFFECT',
		node,
		ctx: { actor, source, bindings: {} },
		ip: 0,
	}
	return haltAtWindow({ ...state, stack: [...state.stack, frame] })
}

/** Mirror of the PLAY_CARD intent's frame push (intents.ts): stage the card,
 *  then LIFO [OPERATION, EMIT CARD_PLAYED, EMIT PUT_INTO_PLAY]. */
function playCard(
	state: GameState,
	iid: CardInstanceId,
	opIndex = 0,
	seat: Seat = 0,
): GameState {
	const staged = moveCard(state, iid, { k: 'STAGING', seat })
	const ctx = { actor: seat, source: iid, bindings: {} }
	const frames: Frame[] = [
		{
			k: 'EMIT',
			event: { k: 'PUT_INTO_PLAY', iid, seat },
			ifInPlay: { iid, seat },
		},
		{ k: 'EMIT', event: { k: 'CARD_PLAYED', iid, seat } },
		{ k: 'OPERATION', card: iid, opIndex, ctx, phase: 0 },
	]
	return { ...staged, stack: [...staged.stack, ...frames] }
}

// ---------------------------------------------------------------------------
// §1 Emission table — every row gets a test
// ---------------------------------------------------------------------------

describe('event emission table (todo/09 §1)', () => {
	it('gain emits CARD_GAINED (and a matching REACTION window opens later)', () => {
		register([mk('em-gain', 'CARGO')])
		let s = fresh()
		s = place(s, 'em-gain', ID('o'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		const { state, events } = effect(
			s,
			{ k: 'GAIN_CARD', suits: ['CARGO'] },
			ID('e'),
			0,
		)
		expect(events.some((e) => e.k === 'CARD_GAINED' && e.iid === ID('o'))).toBe(
			true,
		)
		expect(state.cards[ID('o')]!.owner).toBe(0)
	})

	it('scan emits CARD_GAINED too', () => {
		register([mk('em-scan', 'CARGO')])
		let s = fresh()
		s = place(s, 'em-scan', ID('o'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		const { events } = effect(
			s,
			{ k: 'SCAN_N', n: 1, suits: ['CARGO'] },
			ID('e'),
			0,
		)
		expect(events.some((e) => e.k === 'CARD_GAINED')).toBe(true)
	})

	it('take emits INCIDENT_TAKEN and NOT CARD_GAINED', () => {
		register([mk('em-take', 'SHIP')])
		let s = fresh()
		s = place(s, 'em-take', ID('I'), { k: 'INCIDENT_DECK' })
		const { state, events } = effect(
			s,
			{ k: 'TAKE', deck: 'INCIDENT', count: 1 },
			ID('e'),
			0,
		)
		expect(events.some((e) => e.k === 'CARD_GAINED')).toBe(false)
		expect(
			events.some((e) => e.k === 'INCIDENT_TAKEN' && e.iid === ID('I')),
		).toBe(true)
		expect(state.cards[ID('I')]!.zone).toEqual({ k: 'HAND', seat: 0 })
	})

	it('find emits NOT CARD_GAINED', () => {
		register([mk('em-find', 'CARGO')])
		let s = fresh()
		s = place(s, 'em-find', ID('C'), { k: 'DISCARD', seat: 0 }, 0)
		const { events } = effect(
			s,
			{
				k: 'FIND',
				filter: { suits: ['CARGO'] },
				zones: [{ k: 'DISCARD', seat: 0 }],
			},
			ID('e'),
			0,
		)
		expect(events.some((e) => e.k === 'CARD_GAINED')).toBe(false)
	})

	it('enlist emits NOT CARD_GAINED', () => {
		register([mk('em-enlist', 'SHIP')])
		let s = fresh()
		s = place(s, 'em-enlist', ID('R'), { k: 'RESERVE', seat: 0 }, 0)
		const { events } = effect(s, { k: 'ENLIST_RESERVE' }, ID('e'), 0)
		expect(events.some((e) => e.k === 'CARD_GAINED')).toBe(false)
	})

	it('gain a resource emits RESOURCE_GAINED', () => {
		const { events } = effect(fresh(), gain('DIL', 2), ID('e'), 0)
		expect(
			events.some(
				(e) => e.k === 'RESOURCE_GAINED' && e.res === 'DIL' && e.amount === 2,
			),
		).toBe(true)
	})

	it('steal emits NOT RESOURCE_GAINED', () => {
		let s = fresh()
		s = setResources(s, 1, 'DIL', 5)
		const { state, events } = effect(
			s,
			{ k: 'STEAL', res: 'DIL', amount: 2 },
			ID('e'),
			0,
		)
		expect(events.some((e) => e.k === 'RESOURCE_GAINED')).toBe(false)
		expect(player(state, 0).resources.DIL).toBe(2)
		expect(player(state, 1).resources.DIL).toBe(3)
	})

	it('play emits CARD_PLAYED then PUT_INTO_PLAY, both AFTER the operation', () => {
		register([mk('em-play', 'CARGO', [op('PLAY', gain('DIL', 1))])])
		let s = fresh()
		s = place(s, 'em-play', ID('P'), { k: 'HAND', seat: 0 }, 0)
		const { events } = drive(playCard(s, ID('P'), 0), none)
		const kinds = events.map((e) => e.k)
		const gained = kinds.indexOf('RESOURCE_GAINED')
		const played = kinds.indexOf('CARD_PLAYED')
		const put = kinds.indexOf('PUT_INTO_PLAY')
		expect(gained).toBeGreaterThanOrEqual(0)
		expect(played).toBeGreaterThan(gained)
		expect(put).toBeGreaterThan(played)
	})

	it('take control emits PUT_INTO_PLAY before the CONTROL op and LOCATION_CONTROLLED after', () => {
		register([mk('em-loc', 'LOCATION', [op('CONTROL', gain('LAT', 5))])])
		let s = fresh()
		s = place(s, 'em-loc', ID('L'), { k: 'NEUTRAL_ZONE', slot: 0 })
		const { state, events } = effect(
			s,
			{
				k: 'TAKE_CONTROL',
				target: { zones: [{ k: 'NEUTRAL_ZONE', slot: 0 }] },
			},
			ID('e'),
			0,
		)
		const put = events.findIndex((e) => e.k === 'PUT_INTO_PLAY')
		const controlled = events.findIndex((e) => e.k === 'LOCATION_CONTROLLED')
		expect(put).toBeGreaterThanOrEqual(0)
		expect(controlled).toBeGreaterThan(put)
		// the CONTROL op ran between the two, so its benefit is present
		expect(player(state, 0).resources.LAT).toBe(5)
	})

	it('TRIGGER_CONTROL emits neither PUT_INTO_PLAY nor LOCATION_CONTROLLED', () => {
		register([mk('em-tc', 'LOCATION', [op('CONTROL', gain('LAT', 5))])])
		let s = fresh()
		s = place(s, 'em-tc', ID('L'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		const { state, events } = effect(
			s,
			{
				k: 'TRIGGER_CONTROL',
				target: { zones: [{ k: 'LOCATION_AREA', seat: 0 }] },
			},
			ID('e'),
			0,
		)
		expect(events.some((e) => e.k === 'PUT_INTO_PLAY')).toBe(false)
		expect(events.some((e) => e.k === 'LOCATION_CONTROLLED')).toBe(false)
		expect(player(state, 0).resources.LAT).toBe(5)
	})

	it('promote from hand emits PUT_INTO_PLAY', () => {
		register([mk('em-promote', 'PERSON')])
		let s = fresh()
		s = place(s, 'em-promote', ID('C'), { k: 'HAND', seat: 0 }, 0)
		const { state, events } = effect(
			s,
			{ k: 'PROMOTE', from: 'HAND' },
			ID('e'),
			0,
		)
		expect(
			events.some((e) => e.k === 'PUT_INTO_PLAY' && e.iid === ID('C')),
		).toBe(true)
		expect(state.cards[ID('C')]!.zone).toEqual({ k: 'DUTY_OFFICER', seat: 0 })
	})

	it('beam from hand emits PUT_INTO_PLAY', () => {
		register([mk('em-beam-c', 'CARGO'), mk('em-beam-s', 'SHIP')])
		let s = fresh()
		s = place(s, 'em-beam-c', ID('C'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'em-beam-s', ID('S'), { k: 'FLEET', seat: 0 }, 0)
		const { state, events } = effect(
			s,
			{
				k: 'BEAM',
				to: { zones: [{ k: 'FLEET', seat: 0 }], seat: 'SELF' },
				count: 1,
			},
			ID('e'),
			0,
		)
		expect(
			events.some((e) => e.k === 'PUT_INTO_PLAY' && e.iid === ID('C')),
		).toBe(true)
		expect(state.cards[ID('C')]!.zone).toEqual({ k: 'BEAMED', host: ID('S') })
	})

	it('put into Staging by an effect emits PUT_INTO_PLAY', () => {
		register([mk('em-staging', 'CARGO')])
		let s = fresh()
		s = place(s, 'em-staging', ID('C'), { k: 'HAND', seat: 0 }, 0)
		const { state, events } = effect(
			s,
			{
				k: 'PUT_INTO_STAGING',
				target: { zones: [{ k: 'HAND', seat: 0 }], seat: 'SELF' },
			},
			ID('e'),
			0,
		)
		expect(events.some((e) => e.k === 'PUT_INTO_PLAY')).toBe(true)
		expect(state.cards[ID('C')]!.zone).toEqual({ k: 'STAGING', seat: 0 })
	})
})

// ---------------------------------------------------------------------------
// REACTION windows — the DoD scenarios
// ---------------------------------------------------------------------------

describe('REACTION windows (rules/12 §12.24, todo/09 §3)', () => {
	it('a REACTION interrupting a 3-step SEQ fully resolves, then the SEQ resumes at step 2', () => {
		const seq: Effect = {
			k: 'SEQ',
			steps: [gain('DIL', 1), gain('LAT', 1), gain('GLO', 1)],
		}
		register([
			mk('mid-play', 'CARGO', [op('PLAY', seq)]),
			mk('mid-react', 'SHIP', [
				op('REACTION', gain('GLO', 9), {
					trigger: { on: 'RESOURCE_GAINED', res: 'DIL' },
				}),
			]),
		])
		let s = fresh()
		s = place(s, 'mid-play', ID('P'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'mid-react', ID('R'), { k: 'FLEET', seat: 0 }, 0)

		// The window opens mid-effect: after step 1 (DIL) but before step 2.
		const h = haltAtWindow(playCard(s, ID('P'), 0))
		expect(h.window?.k).toBe('OPTIONAL_TRIGGERS')
		expect(mustTrigger(h).offered.map((o) => o.card)).toContain(ID('R'))
		expect(h.state.players[0]!.resources.DIL).toBe(1) // step 1 done
		expect(h.state.players[0]!.resources.LAT).toBe(0) // step 2 NOT yet
		assertSerialisable(h.state)

		const out = drive(h.state, want)
		// reaction (GLO 9) resolved, then steps 2 + 3 ran: the interrupted op resumed.
		expect(player(out.state, 0).resources).toEqual({ DIL: 1, LAT: 1, GLO: 10 })
		// the play op still completed: CARD_PLAYED + PUT_INTO_PLAY emitted after.
		expect(out.events.some((e) => e.k === 'CARD_PLAYED')).toBe(true)
		expect(out.events.some((e) => e.k === 'PUT_INTO_PLAY')).toBe(true)
		assertSerialisable(out.state)
	})

	it('a player declining all REACTIONs leaves the interrupted operation untouched', () => {
		register([
			mk('dec-play', 'CARGO', [op('PLAY', gain('DIL', 1))]),
			mk('dec-react', 'SHIP', [
				op('REACTION', gain('GLO', 7), {
					trigger: { on: 'RESOURCE_GAINED', res: 'DIL' },
				}),
			]),
		])
		let s = fresh()
		s = place(s, 'dec-play', ID('P'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'dec-react', ID('R'), { k: 'FLEET', seat: 0 }, 0)

		const h = haltAtWindow(playCard(s, ID('P'), 0))
		expect(h.window).not.toBeNull()
		const out = drive(h.state, none) // decline everything
		expect(player(out.state, 0).resources).toEqual({ DIL: 1, LAT: 0, GLO: 0 })
		expect(out.state.cards[ID('R')]!.exhausted).toBe(false) // never used
	})

	it('two cards reacting to one event are BOTH offered and usable in either order', () => {
		register([
			mk('two-play', 'CARGO', [op('PLAY', { k: 'NOOP' })]),
			mk('two-a', 'SHIP', [
				op('REACTION', gain('DIL', 1), {
					trigger: { on: 'CARD_PLAYED', seat: 'ANY' },
				}),
			]),
			mk('two-b', 'SHIP', [
				op('REACTION', gain('LAT', 1), {
					trigger: { on: 'CARD_PLAYED', seat: 'ANY' },
				}),
			]),
		])
		const build = () => {
			let s = fresh()
			s = place(s, 'two-play', ID('P'), { k: 'HAND', seat: 0 }, 0)
			s = place(s, 'two-a', ID('A'), { k: 'FLEET', seat: 0 }, 0)
			s = place(s, 'two-b', ID('B'), { k: 'FLEET', seat: 0 }, 0)
			return playCard(s, ID('P'), 0)
		}
		const refOf = (c: PendingChoice, iid: CardInstanceId) => {
			if (c.k !== 'OPTIONAL_TRIGGERS')
				throw new Error('expected an OPTIONAL_TRIGGERS window')
			return c.offered.find((o) => o.card === iid)!
		}

		// order [A, B]: A resolves first, then B — observable via their gains.
		const h1 = haltAtWindow(build())
		expect(mustTrigger(h1).offered.map((o) => o.card)).toEqual(
			expect.arrayContaining([ID('A'), ID('B')]),
		)
		const outAB = drive(h1.state, (c) => [refOf(c, ID('A')), refOf(c, ID('B'))])
		expect(outAB.state.players[0]!.resources).toEqual({
			DIL: 1,
			LAT: 1,
			GLO: 0,
		})
		const gainedAB = outAB.events
			.filter(
				(e): e is Extract<GameEvent, { k: 'RESOURCE_GAINED' }> =>
					e.k === 'RESOURCE_GAINED' && (e.res === 'DIL' || e.res === 'LAT'),
			)
			.map((e) => e.res)
		expect(gainedAB).toEqual(['DIL', 'LAT'])
		assertSerialisable(outAB.state)

		// order [B, A]:
		const h2 = haltAtWindow(build())
		const outBA = drive(h2.state, (c) => [refOf(c, ID('B')), refOf(c, ID('A'))])
		expect(outBA.state.players[0]!.resources).toEqual({
			DIL: 1,
			LAT: 1,
			GLO: 0,
		})
		const gainedBA = outBA.events
			.filter(
				(e): e is Extract<GameEvent, { k: 'RESOURCE_GAINED' }> =>
					e.k === 'RESOURCE_GAINED' && (e.res === 'DIL' || e.res === 'LAT'),
			)
			.map((e) => e.res)
		expect(gainedBA).toEqual(['LAT', 'DIL'])
	})

	it('REACTION on an exhausted card is not offered; PASSIVE on an exhausted card IS applied', () => {
		register([
			mk('ex-react', 'SHIP', [
				op('REACTION', gain('GLO', 5), {
					trigger: { on: 'RESOURCE_GAINED', res: 'DIL' },
				}),
			]),
			mk('ex-pass', 'SHIP', [
				op('PASSIVE', gain('LAT', 2), {
					trigger: { on: 'RESOURCE_GAINED', res: 'DIL' },
				}),
			]),
		])
		let s = fresh()
		s = place(s, 'ex-react', ID('R'), { k: 'FLEET', seat: 0 }, 0, {
			exhausted: true,
		})
		s = place(s, 'ex-pass', ID('P'), { k: 'FLEET', seat: 0 }, 0, {
			exhausted: true,
		})
		const h = effectToWindow(s, gain('DIL', 1), ID('e'), 0)
		expect(h.window).toBeNull() // exhausted REACTION not offered
		expect(player(h.state, 0).resources.LAT).toBe(2) // exhausted PASSIVE still applied
		expect(player(h.state, 0).resources.GLO).toBe(0)
		assertSerialisable(h.state)
	})

	it('REACTION on a Staging Area card is not offered', () => {
		register([
			mk('st-react', 'SHIP', [
				op('REACTION', gain('GLO', 5), {
					trigger: { on: 'RESOURCE_GAINED', res: 'DIL' },
				}),
			]),
		])
		let s = fresh()
		s = place(s, 'st-react', ID('R'), { k: 'STAGING', seat: 0 }, 0)
		const h = effectToWindow(s, gain('DIL', 1), ID('e'), 0)
		expect(h.window).toBeNull()
		expect(player(h.state, 0).resources.GLO).toBe(0)
	})

	it('a self-deploying card with a matching REACTION can react to its own deployment', () => {
		register([
			mk('self-ship', 'SHIP', [
				op('PLAY', {
					k: 'DEPLOY',
					target: { zones: [{ k: 'STAGING', seat: 0 }], seat: 'SELF' },
				}),
				op('REACTION', gain('DIL', 4), {
					trigger: {
						on: 'CARD_PLAYED',
						filter: { suits: ['SHIP'] },
						seat: 'SELF',
					},
				}),
			]),
		])
		let s = fresh()
		s = place(s, 'self-ship', ID('D'), { k: 'HAND', seat: 0 }, 0)
		const h = haltAtWindow(playCard(s, ID('D'), 0))
		expect(h.window?.k).toBe('OPTIONAL_TRIGGERS')
		expect(mustTrigger(h).offered.map((o) => o.card)).toContain(ID('D')) // its own deployment
		const out = drive(h.state, want)
		expect(out.state.cards[ID('D')]!.zone).toEqual({ k: 'FLEET', seat: 0 }) // deployed
		expect(player(out.state, 0).resources.DIL).toBe(4)
	})

	it('a card that stays in the Staging Area cannot use its REACTION on self-play', () => {
		register([
			mk('stay-ship', 'SHIP', [
				op('PLAY', { k: 'NOOP' }),
				op('REACTION', gain('LAT', 4), {
					trigger: {
						on: 'CARD_PLAYED',
						filter: { suits: ['SHIP'] },
						seat: 'SELF',
					},
				}),
			]),
		])
		let s = fresh()
		s = place(s, 'stay-ship', ID('D'), { k: 'HAND', seat: 0 }, 0)
		const h = haltAtWindow(playCard(s, ID('D'), 0))
		expect(h.window).toBeNull() // still in Staging → table ops unavailable
		expect(h.state.cards[ID('D')]!.zone).toEqual({ k: 'STAGING', seat: 0 })
		expect(player(h.state, 0).resources.LAT).toBe(0)
	})
})

// ---------------------------------------------------------------------------
// Nested / chained REACTIONs (§12.24 p.23 1LOC01 → 1LOC14)
// ---------------------------------------------------------------------------

describe('nested REACTION chains (rules/12 §12.24, todo/09 §6)', () => {
	it('a REACTION emitting an event opens a nested REACTION window and chains', () => {
		register([
			mk('ch-play', 'ENCOUNTER', [op('PLAY', gain('LAT', 1))]),
			// 1LOC01: after YOU play a DISCOVERY, gain Glory and log a card.
			mk('ch-amarg', 'CARGO', [
				op(
					'REACTION',
					{ k: 'SEQ', steps: [gain('GLO', 1), { k: 'LOG', target: 'THIS' }] },
					{
						trigger: {
							on: 'CARD_PLAYED',
							filter: { suits: ['ENCOUNTER'] },
							seat: 'SELF',
						},
					},
				),
			]),
			// 1LOC14: after a card is logged, gain Glory.
			mk('ch-mem', 'CARGO', [
				op('REACTION', gain('GLO', 1), { trigger: { on: 'CARD_LOGGED' } }),
			]),
		])
		let s = fresh()
		s = place(s, 'ch-play', ID('P'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'ch-amarg', ID('A'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'ch-mem', ID('M'), { k: 'FLEET', seat: 0 }, 0)

		const h = haltAtWindow(playCard(s, ID('P'), 0))
		expect(mustTrigger(h).offered.map((o) => o.card)).toEqual([ID('A')]) // 1LOC01 first
		// Take 1LOC01: it gains Glory then logs itself → CARD_LOGGED.
		const s2 = applyChoice(h.state, {
			t: 'RESOLVE_CHOICE',
			choiceId: mustTrigger(h).id,
			selection: [mustTrigger(h).offered[0]!],
		})
		const h2 = haltAtWindow(s2)
		expect(h2.state.players[0]!.resources.GLO).toBe(1) // 1LOC01's Glory
		expect(mustTrigger(h2).offered.map((o) => o.card)).toEqual([ID('M')]) // nested: 1LOC14
		const out = drive(h2.state, want)
		expect(player(out.state, 0).resources.GLO).toBe(2) // + 1LOC14
		expect(out.state.cards[ID('A')]!.zone).toEqual({ k: 'LOG', seat: 0 }) // 1LOC01 logged
		assertSerialisable(out.state)
	})

	it('throws a clear diagnostic beyond MAX_REACTION_DEPTH nested windows', () => {
		let s = fresh()
		for (let i = 0; i < MAX_REACTION_DEPTH; i++) {
			s = {
				...s,
				stack: [
					...s.stack,
					{
						k: 'REACTION_WINDOW' as const,
						event: { k: 'CARD_PLAYED', iid: ID('x'), seat: 0 },
						offered: [],
						seat: 0,
					},
				],
			}
		}
		register([
			mk('depth-react', 'SHIP', [
				op('REACTION', gain('GLO', 1), {
					trigger: { on: 'RESOURCE_GAINED', res: 'DIL' },
				}),
			]),
		])
		s = place(s, 'depth-react', ID('R'), { k: 'FLEET', seat: 0 }, 0)
		s = {
			...s,
			eventQueue: [{ k: 'RESOURCE_GAINED', seat: 0, res: 'DIL', amount: 1 }],
		}
		expect(() => drainEvents(s)).toThrow(/REACTION_WINDOW nesting exceeds/)
	})
})

// ---------------------------------------------------------------------------
// No-gain rulings wired to triggers (DoD)
// ---------------------------------------------------------------------------

describe('triggers respect the no-gain rulings (todo/09 §1, rules/04 §4.3.3, rules/08)', () => {
	it('steal does not fire a "when you gain a resource" REACTION; gain does', () => {
		register([
			mk('star-react', 'SHIP', [
				op('REACTION', gain('GLO', 1), {
					trigger: { on: 'RESOURCE_GAINED', res: 'DIL' },
				}),
			]),
		])

		// steal: victim holds DIL; p0 steals → no window.
		let s = fresh()
		s = setResources(s, 1, 'DIL', 5)
		s = place(s, 'star-react', ID('R'), { k: 'FLEET', seat: 0 }, 0)
		const stealHalt = effectToWindow(
			s,
			{ k: 'STEAL', res: 'DIL', amount: 2 },
			ID('e'),
			0,
		)
		expect(stealHalt.window).toBeNull()
		expect(player(stealHalt.state, 0).resources.DIL).toBe(2)

		// gain: → window offering R.
		let s2 = fresh()
		s2 = place(s2, 'star-react', ID('R2'), { k: 'FLEET', seat: 0 }, 0)
		const gainHalt = effectToWindow(s2, gain('DIL', 1), ID('e'), 0)
		expect(gainHalt.window?.k).toBe('OPTIONAL_TRIGGERS')
		expect(mustTrigger(gainHalt).offered.map((o) => o.card)).toContain(ID('R2'))
	})

	it('take an INCIDENT does not fire a "when you gain a card" REACTION; scan does', () => {
		register([
			mk('gc-react', 'SHIP', [
				op('REACTION', gain('GLO', 1), { trigger: { on: 'CARD_GAINED' } }),
			]),
			mk('gc-cargo', 'CARGO'),
			mk('gc-inc', 'SHIP'),
		])

		// take an INCIDENT → CARD_GAINED never fires → no window.
		let s = fresh()
		s = place(s, 'gc-react', ID('R'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'gc-inc', ID('I'), { k: 'INCIDENT_DECK' })
		const takeHalt = effectToWindow(
			s,
			{ k: 'TAKE', deck: 'INCIDENT', count: 1 },
			ID('e'),
			0,
		)
		expect(takeHalt.window).toBeNull()

		// scan → CARD_GAINED fires → window offers R.
		let s2 = fresh()
		s2 = place(s2, 'gc-react', ID('R2'), { k: 'FLEET', seat: 0 }, 0)
		s2 = place(s2, 'gc-cargo', ID('O'), { k: 'MARKET_OFFER', suit: 'CARGO' })
		s2 = place(s2, 'gc-cargo', ID('D'), { k: 'MARKET_DECK', suit: 'CARGO' })
		const scanHalt = effectToWindow(
			s2,
			{ k: 'SCAN_N', n: 2, suits: ['CARGO'] },
			ID('e'),
			0,
		)
		expect(scanHalt.window?.k).toBe('OPTIONAL_TRIGGERS')
		expect(mustTrigger(scanHalt).offered.map((o) => o.card)).toContain(ID('R2'))
	})

	it('"after you gain an ALLY" (1PIC01) fires on its owner\'s gain only, never the opponent\'s', () => {
		register([
			mk('ga-react', 'SHIP', [
				op('REACTION', gain('GLO', 1), {
					trigger: { on: 'CARD_GAINED', filter: { suits: ['ALLY'] } },
				}),
			]),
			mk('ga-opp', 'SHIP', [
				op('REACTION', gain('GLO', 1), {
					trigger: { on: 'CARD_GAINED', seat: 'OPPONENT' },
				}),
			]),
			mk('ga-ally', 'ALLY'),
		])
		const setup = (): GameState => {
			let s = fresh()
			s = place(s, 'ga-react', ID('R'), { k: 'FLEET', seat: 1 }, 1) // seat 1's "after you gain"
			s = place(s, 'ga-ally', ID('A'), { k: 'MARKET_OFFER', suit: 'ALLY' })
			s = place(s, 'ga-ally', ID('D'), { k: 'MARKET_DECK', suit: 'ALLY' })
			return s
		}

		// seat 0 gains an ALLY → seat 1's default-SELF reaction stays silent.
		const oppGain = effectToWindow(
			setup(),
			{ k: 'GAIN_CARD', suits: ['ALLY'] },
			ID('e'),
			0,
		)
		expect(
			oppGain.window?.k === 'OPTIONAL_TRIGGERS'
				? oppGain.window.offered.map((o) => o.card)
				: [],
		).not.toContain(ID('R'))

		// seat 1 gains an ALLY → offered.
		const ownGain = effectToWindow(
			setup(),
			{ k: 'GAIN_CARD', suits: ['ALLY'] },
			ID('e'),
			1,
		)
		expect(mustTrigger(ownGain).offered.map((o) => o.card)).toContain(ID('R'))

		// explicit OPPONENT scoping (1SIS06) fires on the other seat's gain only.
		let s = setup()
		s = place(s, 'ga-opp', ID('O'), { k: 'FLEET', seat: 1 }, 1)
		const viaOpp = effectToWindow(
			s,
			{ k: 'GAIN_CARD', suits: ['ALLY'] },
			ID('e'),
			0,
		)
		expect(mustTrigger(viaOpp).offered.map((o) => o.card)).toEqual([ID('O')])
	})
})

// ---------------------------------------------------------------------------
// PASSIVEs — mandatory, deterministic, loop-guarded
// ---------------------------------------------------------------------------

describe('PASSIVE operations (rules/12 §12.25, todo/09 §2)', () => {
	it('a self-retriggering PASSIVE is caught by the loop guard, not by the browser', () => {
		register([
			mk('spin-pass', 'SHIP', [
				op('PASSIVE', gain('DIL', 1), {
					trigger: { on: 'RESOURCE_GAINED', res: 'DIL' },
				}),
			]),
		])
		let s = fresh()
		s = place(s, 'spin-pass', ID('P'), { k: 'FLEET', seat: 0 }, 0)
		// must NOT throw MAX_STEPS — the guard cuts the feedback loop.
		const out = effect(s, gain('DIL', 1), ID('e'), 0)
		expect(player(out.state, 0).resources.DIL).toBe(2) // initial gain + ONE passive fire
		expect(
			out.state.log.some((l) => l.message.includes('PASSIVE loop guard')),
		).toBe(true)
		assertSerialisable(out.state)
	})

	it('a PASSIVE still fires any number of times for independent events', () => {
		register([
			mk('rep-pass', 'SHIP', [
				op('PASSIVE', gain('DIL', 1), {
					trigger: { on: 'RESOURCE_GAINED', res: 'DIL' },
				}),
			]),
		])
		let s = fresh()
		s = place(s, 'rep-pass', ID('P'), { k: 'FLEET', seat: 0 }, 0)
		const seq: Effect = { k: 'SEQ', steps: [gain('DIL', 1), gain('DIL', 1)] }
		const out = effect(s, seq, ID('e'), 0)
		// base 2 gains + one passive fire per event (its own feedback is blocked)
		expect(player(out.state, 0).resources.DIL).toBe(4)
	})

	it('PASSIVE ordering is deterministic: active player first, then Location→…→Status', () => {
		// p0 (active) fires before p1; FLEET before CAPTAIN. RESOURCE_GAINED
		// passives are owner-only, so keying both players' passives on a single
		// CARD_PLAYED with seat: 'ANY' exercises the cross-player order.
		register([
			mk('ord-play', 'CARGO', [op('PLAY', { k: 'NOOP' })]),
			mk('ord-p0-fleet', 'SHIP', [
				op('PASSIVE', gain('DIL', 1), {
					trigger: { on: 'CARD_PLAYED', seat: 'ANY' },
				}),
			]),
			mk('ord-p0-cap', 'SHIP', [
				op('PASSIVE', gain('DIL', 3), {
					trigger: { on: 'CARD_PLAYED', seat: 'ANY' },
				}),
			]),
			mk('ord-p1-cap', 'SHIP', [
				op('PASSIVE', gain('DIL', 2), {
					trigger: { on: 'CARD_PLAYED', seat: 'ANY' },
				}),
			]),
		])
		let s = fresh()
		s = place(s, 'ord-play', ID('P'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'ord-p0-fleet', ID('A'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'ord-p0-cap', ID('B'), { k: 'CAPTAIN', seat: 0 }, 0)
		s = place(s, 'ord-p1-cap', ID('C'), { k: 'CAPTAIN', seat: 1 }, 1)
		// deterministic order A (p0 fleet), B (p0 captain), C (p1 captain) — all
		// mandatory. A and B grant p0 +1/+3; C grants p1 +2.
		const out = drive(playCard(s, ID('P'), 0), none)
		expect(player(out.state, 0).resources.DIL).toBe(4)
		expect(player(out.state, 1).resources.DIL).toBe(2)
		// Order is observable via the DIL amounts: p0 fleet +1, p0 captain +3,
		// then p1 captain +2.
		const dilSeq = out.events
			.filter(
				(e): e is Extract<GameEvent, { k: 'RESOURCE_GAINED' }> =>
					e.k === 'RESOURCE_GAINED' && e.res === 'DIL',
			)
			.map((e) => e.amount)
		expect(dilSeq).toEqual([1, 3, 2])
	})
})

// ---------------------------------------------------------------------------
// Two players' simultaneous reactions — deterministic order (todo/09 §5)
// ---------------------------------------------------------------------------

describe('cross-player reaction ordering (todo/09 §5)', () => {
	it("the event's player gets their window first, then the other player", () => {
		register([
			mk('ord-play', 'CARGO', [op('PLAY', { k: 'NOOP' })]),
			mk('ord-p0', 'SHIP', [
				op('REACTION', gain('DIL', 1), {
					trigger: { on: 'CARD_PLAYED', seat: 'ANY' },
				}),
			]),
			mk('ord-p1', 'SHIP', [
				op('REACTION', gain('LAT', 1), {
					trigger: { on: 'CARD_PLAYED', seat: 'ANY' },
				}),
			]),
		])
		let s = fresh()
		s = place(s, 'ord-play', ID('P'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'ord-p0', ID('A'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'ord-p1', ID('B'), { k: 'FLEET', seat: 1 }, 1)

		const h = haltAtWindow(playCard(s, ID('P'), 0))
		expect(h.window?.seat).toBe(0) // event's player (p0 played the card)
		expect(mustTrigger(h).offered.map((o) => o.card)).toEqual([ID('A')])
		assertSerialisable(h.state)

		// Decline p0's window → p1's window opens next.
		const s2 = applyChoice(h.state, {
			t: 'RESOLVE_CHOICE',
			choiceId: mustTrigger(h).id,
			selection: [],
		})
		const h2 = haltAtWindow(s2)
		expect(h2.window?.seat).toBe(1)
		expect(mustTrigger(h2).offered.map((o) => o.card)).toEqual([ID('B')])
		const out = drive(h2.state, want)
		expect(player(out.state, 1).resources.LAT).toBe(1) // p1 took their reaction
		expect(player(out.state, 0).resources.DIL).toBe(0) // p0 declined theirs
		assertSerialisable(out.state)
	})
})
