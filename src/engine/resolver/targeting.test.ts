// Cross-cutting targeting fixes (box-1 card audit):
//   - ZoneSpec 'LOCATIONS' / 'NEUTRAL_LOCATIONS': warp / send / remove targets
//     reach the Neutral Zone (NZ Locations are unowned, so 'IN_PLAY' never did)
//   - ZoneSpec {k:'BEAMED_TO', host:'THIS' | bound}: "a card beamed here"
//     (the old {k:'BEAMED', host:'<card name>'} never matched — zone keys use
//     instance ids)
//   - Query withShip: CardFilter (a named ship's LOCATION), WARP bind
//     (the LOCATION just warped to), atThisShip for a card beamed to a SHIP
//     (an AWAY TEAM sent to the LOCATION of the SHIP it is beamed to)
//   - COST_DISMISS from ("dismiss a PERSON … that is beamed here")
//   - FIND searches hand/Discard/Draw/Reserve unless the text restricts it
// plus representative real-card checks against the fixed card data.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CardArraySchema, CardDefSchema, type CardDef } from '../../data/schema'
import type { Effect } from './nodes'
import type { EffectCtx, GameState } from '../state'
import {
	fresh,
	register,
	makeDef,
	place,
	ID,
	pushAndRun,
	setResources,
} from './testUtils'
import { run } from './stack'
import { applyChoice } from './choices'
import { resolveQuery } from '../queries/resolveQuery'
import { describe as describeEffect } from '../describe'

const defsOf = (file: string): CardDef[] =>
	CardArraySchema.parse(
		JSON.parse(
			readFileSync(join(__dirname, `../../data/cards/${file}.json`), 'utf8'),
		),
	)
const real = (file: string, cardId: string): CardDef =>
	defsOf(file).find((d) => d.cardId === cardId)!

function answer(state: GameState, selection: unknown): GameState {
	const ch = state.pendingChoice
	if (ch === null) throw new Error('expected a pending choice')
	return run(
		applyChoice(state, {
			t: 'RESOLVE_CHOICE',
			choiceId: ch.id,
			selection,
		} as never),
	)
}

const ctxOf = (
	source: string,
	bindings: EffectCtx['bindings'] = {},
	actor: 0 | 1 = 0,
): EffectCtx => ({ actor, source: ID(source), bindings })

register([
	makeDef({ id: 'tg-loc', suit: 'LOCATION', operations: [] }),
	makeDef({ id: 'tg-ship', suit: 'SHIP', operations: [] }),
	makeDef({
		id: 'tg-named-ship',
		suit: 'SHIP',
		operations: [],
	}),
	makeDef({ id: 'tg-person', suit: 'PERSON', operations: [] }),
	makeDef({
		id: 'tg-human',
		suit: 'PERSON',
		traits: ['HUMAN'],
		operations: [],
	}),
	makeDef({ id: 'tg-cargo', suit: 'CARGO', operations: [] }),
])

/** Board: p0 controls L0, p1 controls L1, NZ slots hold N0/N1/N2. */
function board(): GameState {
	let s = fresh()
	s = place(s, 'tg-loc', ID('L0'), { k: 'LOCATION_AREA', seat: 0 }, 0)
	s = place(s, 'tg-loc', ID('L1'), { k: 'LOCATION_AREA', seat: 1 }, 1)
	for (const slot of [0, 1, 2] as const)
		s = place(s, 'tg-loc', ID(`N${slot}`), { k: 'NEUTRAL_ZONE', slot }, null)
	const players = s.players.map((p) => ({ ...p, awayTeamsInPool: 3 }))
	return { ...s, players: players as GameState['players'] }
}

describe("ZoneSpec 'LOCATIONS' / 'NEUTRAL_LOCATIONS'", () => {
	it('LOCATIONS = your controlled Locations + every Neutral Zone Location', () => {
		const s = board()
		const q = { zones: ['LOCATIONS' as const] }
		expect(resolveQuery(s, q, ctxOf('x'))).toEqual(['L0', 'N0', 'N1', 'N2'])
		// seat-relative: the opponent's controlled Locations for seat 1
		expect(resolveQuery(s, q, ctxOf('x', {}, 1))).toEqual([
			'L1',
			'N0',
			'N1',
			'N2',
		])
		// seat ANY: both Location Areas ("remove an opponent AWAY TEAM from a LOCATION")
		expect(resolveQuery(s, { ...q, seat: 'ANY' }, ctxOf('x'))).toEqual([
			'L0',
			'L1',
			'N0',
			'N1',
			'N2',
		])
		// IN_PLAY never reached the (unowned) Neutral Zone — the bug this replaces
		expect(
			resolveQuery(
				s,
				{ zones: ['IN_PLAY'], filter: { suits: ['LOCATION'] } },
				ctxOf('x'),
			),
		).toEqual(['L0'])
	})

	it('NEUTRAL_LOCATIONS = the three Neutral Zone slots only', () => {
		expect(
			resolveQuery(board(), { zones: ['NEUTRAL_LOCATIONS'] }, ctxOf('x')),
		).toEqual(['N0', 'N1', 'N2'])
	})

	it('SEND_AWAY_TEAM over LOCATIONS can target the Neutral Zone', () => {
		let s = board()
		s = pushAndRun(
			s,
			{
				k: 'SEND_AWAY_TEAM',
				count: 1,
				target: { zones: ['LOCATIONS'], filter: { suits: ['LOCATION'] } },
			},
			ID('x'),
			0,
		)
		const ch = s.pendingChoice
		expect(ch?.k).toBe('CHOOSE_LOCATION')
		expect(ch?.k === 'CHOOSE_LOCATION' && ch.candidates).toEqual([
			'L0',
			'N0',
			'N1',
			'N2',
		])
		s = answer(s, ID('N1'))
		expect(s.awayTeamsAt[ID('N1')]?.[0]).toBe(1)
	})

	it('describes "a LOCATION" / "a LOCATION in the Neutral Zone"', () => {
		expect(
			describeEffect({
				k: 'SEND_AWAY_TEAM',
				count: 1,
				target: { zones: ['LOCATIONS'], filter: { suits: ['LOCATION'] } },
			}),
		).toMatch(/to a LOCATION\.?$/)
		expect(
			describeEffect({
				k: 'SEND_AWAY_TEAM',
				count: 1,
				target: {
					zones: ['NEUTRAL_LOCATIONS'],
					filter: { suits: ['LOCATION'] },
				},
			}),
		).toMatch(/to a LOCATION in the Neutral Zone\.?$/)
	})
})

describe("ZoneSpec {k:'BEAMED_TO'} — cards beamed to one specific card", () => {
	function beamed(): GameState {
		let s = board()
		s = place(s, 'tg-ship', ID('S1'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'tg-ship', ID('S2'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'tg-person', ID('a'), { k: 'BEAMED', host: ID('S1') }, 0)
		s = place(s, 'tg-cargo', ID('b'), { k: 'BEAMED', host: ID('S1') }, 0)
		s = place(s, 'tg-person', ID('c'), { k: 'BEAMED', host: ID('S2') }, 0)
		s = place(s, 'tg-person', ID('d'), { k: 'BEAMED', host: ID('L0') }, 0)
		return s
	}

	it("host 'THIS' = the resolving card; `bound` = the card bound under that name", () => {
		const s = beamed()
		const here = { zones: [{ k: 'BEAMED_TO' as const, host: 'THIS' as const }] }
		expect(resolveQuery(s, here, ctxOf('S1'))).toEqual(['a', 'b'])
		expect(resolveQuery(s, here, ctxOf('L0'))).toEqual(['d'])
		// inside DUPLICATE "here" redirects to the duplicating card
		expect(
			resolveQuery(s, here, { ...ctxOf('S1'), duplicating: ID('S2') }),
		).toEqual(['c'])
		const atBound = { zones: [{ k: 'BEAMED_TO' as const, bound: 'ship' }] }
		expect(resolveQuery(s, atBound, ctxOf('x', { ship: 'S2' }))).toEqual(['c'])
		expect(resolveQuery(s, atBound, ctxOf('x'))).toEqual([]) // unbound → nothing
	})

	it('BEAMED_TO_SHIP excludes cards beamed to a LOCATION (BEAMED_ANY does not)', () => {
		const s = beamed()
		expect(resolveQuery(s, { zones: ['BEAMED_TO_SHIP'] }, ctxOf('x'))).toEqual(
			expect.not.arrayContaining(['d']),
		)
		expect(resolveQuery(s, { zones: ['BEAMED_ANY'] }, ctxOf('x'))).toContain(
			'd',
		)
	})

	it('card data cannot name a host: the runtime {k:"BEAMED", host} ref is rejected', () => {
		const card = (zones: unknown[]): unknown => ({
			...makeDef({
				id: 'tg-bad',
				suit: 'PERSON',
				operations: [
					{
						type: 'ACTIVATION',
						costsAction: false,
						isAttack: false,
						effect: { k: 'RECALL', target: { zones } } as Effect,
						text: 't',
					},
				],
			}),
		})
		expect(
			CardDefSchema.safeParse(card([{ k: 'BEAMED', host: '1SIS03' }])).success,
		).toBe(false)
		expect(
			CardDefSchema.safeParse(card([{ k: 'BEAMED_TO', host: 'THIS' }])).success,
		).toBe(true)
	})

	it('COST_DISMISS from BEAMED_TO: only a card beamed here can pay', () => {
		let s = board()
		s = place(s, 'tg-ship', ID('V'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'tg-ship', ID('W'), { k: 'FLEET', seat: 0 }, 0)
		s = place(
			s,
			'tg-human',
			ID('h-elsewhere'),
			{ k: 'BEAMED', host: ID('W') },
			0,
		)
		s = place(s, 'tg-human', ID('h-duty'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		const node: Effect = {
			k: 'PAY_THEN',
			cost: {
				k: 'COST_DISMISS',
				filter: { suits: ['PERSON'], traits: ['HUMAN'] },
				count: 1,
				from: { k: 'BEAMED_TO', host: 'THIS' },
			},
			body: { k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 },
		}
		const lat = s.players[0].resources.LAT
		const unpaid = pushAndRun(s, node, ID('V'), 0)
		expect(unpaid.players[0].resources.LAT).toBe(lat) // no HUMAN beamed to V
		s = place(s, 'tg-human', ID('h-here'), { k: 'BEAMED', host: ID('V') }, 0)
		s = pushAndRun(s, node, ID('V'), 0)
		expect(s.cards[ID('h-here')]!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		expect(s.cards[ID('h-duty')]!.zone.k).toBe('DUTY_OFFICER')
		expect(s.players[0].resources.LAT).toBe(lat + 1)
	})
})

describe('Query withShip filter / atThisShip for beamed cards / WARP bind', () => {
	it('withShip: CardFilter = only Locations where a matching SHIP of yours is', () => {
		let s = board()
		s = place(s, 'tg-ship', ID('S'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('N0'),
		})
		s = place(s, 'tg-named-ship', ID('D'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('N2'),
		})
		const q = { zones: ['LOCATIONS' as const] }
		expect(resolveQuery(s, { ...q, withShip: true }, ctxOf('x'))).toEqual([
			'N0',
			'N2',
		])
		expect(
			resolveQuery(
				s,
				{ ...q, withShip: { ids: ['tg-named-ship'] } },
				ctxOf('x'),
			),
		).toEqual(['N2'])
	})

	it("atThisShip: a card beamed to a SHIP is at that ship's LOCATION", () => {
		let s = board()
		s = place(s, 'tg-ship', ID('S'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('N1'),
		})
		s = place(s, 'tg-person', ID('P'), { k: 'BEAMED', host: ID('S') }, 0)
		const q = { zones: ['LOCATIONS' as const], atThisShip: true }
		expect(resolveQuery(s, q, ctxOf('P'))).toEqual(['N1'])
		expect(resolveQuery(s, q, ctxOf('S'))).toEqual(['N1'])
		expect(resolveQuery(s, q, ctxOf('L0'))).toEqual([]) // not at any Location
	})

	it('WARP bind = the destination (a follow-up send goes there)', () => {
		let s = board()
		s = place(s, 'tg-ship', ID('S'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('N0'),
		})
		s = pushAndRun(
			s,
			{
				k: 'SEQ',
				steps: [
					{
						k: 'WARP',
						ship: { zones: [{ k: 'FLEET', seat: 0 }] },
						to: { zones: ['LOCATIONS'] },
						bind: 'to',
					},
					{
						k: 'SEND_AWAY_TEAM',
						count: 1,
						target: { zones: ['LOCATIONS'], bound: 'to' },
					},
				],
			},
			ID('x'),
			0,
		)
		// staying put is not warping: N0 is not offered
		const ch = s.pendingChoice
		expect(ch?.k === 'CHOOSE_LOCATION' && ch.candidates).toEqual([
			'L0',
			'N1',
			'N2',
		])
		s = answer(s, ID('N2'))
		expect(s.pendingChoice).toBeNull()
		expect(s.cards[ID('S')]!.shipTokenAt).toBe('N2')
		expect(s.awayTeamsAt[ID('N2')]?.[0]).toBe(1) // no second choice: bound
	})
})

// ---------------------------------------------------------------------------
// Real card data
// ---------------------------------------------------------------------------

describe('real cards — Neutral Zone reach', () => {
	const ktinga = real('common/ship', '1SHI05/13')
	register([ktinga])

	it('1SHI05: "Spend 1 DIL to warp this ship" reaches the Neutral Zone', () => {
		let s = board()
		s = place(s, ktinga.id, ID('K'), { k: 'FLEET', seat: 0 }, 0)
		s = setResources(s, 0, 'DIL', 1)
		s = pushAndRun(s, ktinga.operations[1]!.effect, ID('K'), 0)
		const ch = s.pendingChoice
		expect(ch?.k === 'CHOOSE_LOCATION' && ch.candidates).toEqual([
			'L0',
			'N0',
			'N1',
			'N2',
		])
		s = answer(s, ID('N0'))
		expect(s.cards[ID('K')]!.shipTokenAt).toBe('N0')
	})
})

describe('real cards — "beamed here"', () => {
	const ds9 = real('crew/sis', '1SIS03/25')
	const kol13 = real('crew/kol', '1KOL13/24')
	register([ds9, kol13])

	it('1SIS03: "recall a card beamed here" offers only DS9\'s beamed cards', () => {
		let s = board()
		s = place(s, ds9.id, ID('DS9'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'tg-ship', ID('S'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'tg-person', ID('mine'), { k: 'BEAMED', host: ID('DS9') }, 0)
		s = place(s, 'tg-person', ID('other'), { k: 'BEAMED', host: ID('S') }, 0)
		s = place(s, 'tg-cargo', ID('h1'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'tg-cargo', ID('h2'), { k: 'HAND', seat: 0 }, 0)
		s = pushAndRun(s, ds9.operations[1]!.effect, ID('DS9'), 0)
		// pay: discard a card
		expect(s.pendingChoice?.k).toBe('CHOOSE_CARDS')
		s = answer(s, [ID('h1')])
		const opt = s.pendingChoice
		expect(opt?.k).toBe('CHOOSE_OPTION')
		const recall =
			opt?.k === 'CHOOSE_OPTION'
				? opt.options.find((o) => /recall/i.test(o.label))
				: undefined
		expect(recall?.enabled).toBe(true) // used to be unresolvable (name host)
		s = answer(s, { key: recall!.key })
		expect(s.pendingChoice).toBeNull() // the only card beamed here: auto-picked
		expect(s.cards[ID('mine')]!.zone).toEqual({ k: 'HAND', seat: 0 })
		expect(s.cards[ID('other')]!.zone.k).toBe('BEAMED')
	})

	it('1KOL13: "Resupply: gain 1 DIL for each PERSON beamed here"', () => {
		let s = board()
		s = place(s, kol13.id, ID('RP'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		s = place(s, 'tg-person', ID('p1'), { k: 'BEAMED', host: ID('RP') }, 0)
		s = place(s, 'tg-person', ID('p2'), { k: 'BEAMED', host: ID('RP') }, 0)
		s = place(s, 'tg-cargo', ID('c1'), { k: 'BEAMED', host: ID('RP') }, 0)
		s = place(s, 'tg-person', ID('p3'), { k: 'BEAMED', host: ID('L0') }, 0)
		s = setResources(s, 0, 'DIL', 0)
		s = pushAndRun(s, kol13.operations[2]!.effect, ID('RP'), 0)
		expect(s.players[0].resources.DIL).toBe(2)
	})
})

describe('real cards — FIND searches hand, Discard, Draw and Reserve', () => {
	const per06 = real('common/person', '1PER06/25')
	const loc16 = real('common/location', '1LOC16/20')
	register([
		per06,
		loc16,
		makeDef({
			id: 'tg-synth',
			suit: 'PERSON',
			traits: ['SYNTHETIC'],
			operations: [],
		}),
	])

	it('1PER06: "Find and free play a SYNTHETIC" — a SYNTHETIC in hand or Reserve counts', () => {
		const find = per06.operations[0]!.effect
		if (find.k !== 'SEQ' || find.steps[0]?.k !== 'FIND')
			throw new Error('unexpected 1PER06 tree')
		const zones = find.steps[0].zones
		for (const where of [
			{ k: 'HAND', seat: 0 },
			{ k: 'RESERVE', seat: 0 },
		] as const) {
			let s = fresh()
			s = place(s, 'tg-synth', ID('syn'), where, 0)
			expect(
				resolveQuery(s, { zones, filter: find.steps[0].filter }, ctxOf('x')),
			).toEqual(['syn'])
		}
	})

	it('1LOC16: finds up to 3 PERSON, skipping the Reserve deck', () => {
		const rep = loc16.operations[0]!.effect
		if (
			rep.k !== 'REPEAT' ||
			rep.body.k !== 'SEQ' ||
			rep.body.steps[0]?.k !== 'FIND'
		)
			throw new Error('unexpected 1LOC16 tree')
		const q = {
			zones: rep.body.steps[0].zones,
			filter: { suits: ['PERSON' as const] },
		}
		let s = fresh()
		s = place(s, 'tg-person', ID('inHand'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'tg-person', ID('inRes'), { k: 'RESERVE', seat: 0 }, 0)
		expect(resolveQuery(s, q, ctxOf('x'))).toEqual(['inHand'])
	})
})

describe('FIND shuffles the facedown decks it searched (rules/08 find)', () => {
	register([
		makeDef({
			id: 'tg-doc',
			suit: 'PERSON',
			traits: ['DOCTOR'],
			operations: [],
		}),
	])
	const findDoc = (zones: import('./queries').ZoneSpec[]): Effect => ({
		k: 'FIND',
		filter: { traits: ['DOCTOR'] },
		zones,
	})
	/** Draw deck d0..d9 (d0 on top) with the DOCTOR at index 4; Reserve r0..r5. */
	function decks(): GameState {
		let s = fresh(7)
		for (let i = 0; i < 10; i++)
			s = place(
				s,
				i === 4 ? 'tg-doc' : 'tg-cargo',
				ID(`d${i}`),
				{ k: 'DRAW', seat: 0 },
				0,
			)
		for (let i = 0; i < 6; i++)
			s = place(s, 'tg-cargo', ID(`r${i}`), { k: 'RESERVE', seat: 0 }, 0)
		return s
	}
	const ALL = [
		{ k: 'HAND', seat: 0 },
		{ k: 'DISCARD', seat: 0 },
		{ k: 'DRAW', seat: 0 },
		{ k: 'RESERVE', seat: 0 },
	] as const

	it('finds the card and shuffles both Draw and Reserve (rng consumed)', () => {
		const s0 = decks()
		const s = pushAndRun(s0, findDoc([...ALL]), ID('src'), 0)
		expect(s.cards['d4']!.zone).toEqual({ k: 'HAND', seat: 0 })
		const draw = s.zones['DRAW:0']!
		const reserve = s.zones['RESERVE:0']!
		expect([...draw].sort()).toEqual(
			['d0', 'd1', 'd2', 'd3', 'd5', 'd6', 'd7', 'd8', 'd9'].sort(),
		)
		expect(draw).not.toEqual([
			'd0',
			'd1',
			'd2',
			'd3',
			'd5',
			'd6',
			'd7',
			'd8',
			'd9',
		])
		expect([...reserve].sort()).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5'])
		expect(reserve).not.toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5'])
		expect(s.rng.counter).toBeGreaterThan(s0.rng.counter)
	})

	it('"except in your Reserve deck": the Reserve is not searched, so not shuffled', () => {
		const s = pushAndRun(
			decks(),
			findDoc([ALL[0], ALL[1], ALL[2]]),
			ID('src'),
			0,
		)
		expect(s.zones['RESERVE:0']).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5'])
		expect(s.zones['DRAW:0']).not.toEqual([
			'd0',
			'd1',
			'd2',
			'd3',
			'd5',
			'd6',
			'd7',
			'd8',
			'd9',
		])
	})

	it('a hand/Discard-only FIND consumes no randomness', () => {
		let s0 = decks()
		s0 = place(s0, 'tg-doc', ID('h1'), { k: 'HAND', seat: 0 }, 0)
		const s = pushAndRun(s0, findDoc([ALL[0], ALL[1]]), ID('src'), 0)
		expect(s.rng).toEqual(s0.rng)
		expect(s.zones['DRAW:0']).toEqual(s0.zones['DRAW:0'])
	})
})
