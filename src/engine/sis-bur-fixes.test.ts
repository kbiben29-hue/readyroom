// Regression tests for the SIS/BUR STCC re-verification pass. Each test
// loads the REAL card definition from src/data/cards and resolves it through
// the stack, asserting the behaviour the STCC text describes.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CardArraySchema, type CardDef } from '../data/schema'
import {
	fresh,
	register,
	makeDef,
	op,
	place,
	ID,
	setResources,
	setSpecialty,
	setActions,
} from './resolver/testUtils'
import { run } from './resolver/stack'
import { applyChoice, type PendingChoice } from './resolver/choices'
import type { GameState } from './state'
import type { CardInstanceId } from './ids'

const byCardId = new Map<string, CardDef>()
for (const f of ['crew/sis', 'crew/bur']) {
	const raw: unknown = JSON.parse(
		readFileSync(join(__dirname, `../data/cards/${f}.json`), 'utf8'),
	)
	for (const def of CardArraySchema.parse(raw))
		if (def.cardId !== null) byCardId.set(def.cardId, def)
}
register([...byCardId.values()])
const real = (cardId: string): string => byCardId.get(cardId)!.id

register([
	makeDef({ id: 'sbPlain', suit: 'PERSON', operations: [] }),
	makeDef({
		id: 'sbShipLat1',
		suit: 'SHIP',
		operations: [op('PLAY', { k: 'GAIN_RESOURCE', res: 'LAT', amount: 1 })],
	}),
	makeDef({
		id: 'sbShipLat5',
		suit: 'SHIP',
		operations: [op('PLAY', { k: 'GAIN_RESOURCE', res: 'LAT', amount: 5 })],
	}),
])

type Answer = (c: PendingChoice) => unknown
const auto: Answer = (c) => {
	switch (c.k) {
		case 'CONFIRM':
			return true
		case 'CHOOSE_OPTION':
			return { key: c.options.find((o) => o.enabled)!.key }
		case 'CHOOSE_CARDS':
			return c.candidates.slice(0, Math.max(c.min, 1))
		case 'CHOOSE_LOCATION':
			return c.candidates[0]
		case 'OPTIONAL_TRIGGERS':
			return c.offered
		case 'CHOOSE_SPECIALTY':
			return c.specialties[0]
		default:
			throw new Error(`test driver: unhandled choice ${c.k}`)
	}
}

function drive(state: GameState, answer: Answer = auto): GameState {
	let s = run(state)
	for (let guard = 0; s.pendingChoice !== null; guard++) {
		if (guard > 100) throw new Error('drive: too many choices')
		const c = s.pendingChoice
		s = run(
			applyChoice(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: c.id,
				selection: (answer(c) ?? auto(c)) as never,
			}),
		)
	}
	return s
}

function resolveOp(
	state: GameState,
	card: CardInstanceId,
	opIndex: number,
	answer?: Answer,
): GameState {
	state = setActions(state, 0, 3)
	return drive(
		{
			...state,
			stack: [
				...state.stack,
				{
					k: 'OPERATION',
					card,
					opIndex,
					ctx: { actor: 0, source: card, bindings: {} },
					phase: 0,
				},
			],
		},
		answer,
	)
}

/** BUR's 1BUR02 in play with `parked` DIL on it, its layer on. */
function withParkedDilithium(s: GameState, parked: number): GameState {
	s = place(s, real('1BUR02/26'), ID('inert'), { k: 'STATUS', seat: 0 }, 0, {
		resourceTokens: { DIL: parked },
	})
	const players = s.players.map((p) =>
		p.seat === 0
			? {
					...p,
					modifiers: [...p.modifiers, { id: '1BUR02', source: ID('inert') }],
				}
			: p,
	) as GameState['players']
	return { ...s, players }
}

describe('RECRYSTALLIZE under 1BUR02 (rules/11 §11.6.1 #6)', () => {
	it('1BUR07: 2 parked DIL move to the pool (not re-parked)', () => {
		let s = withParkedDilithium(fresh(), 3)
		s = place(s, real('1BUR07/26'), ID('bur07'), { k: 'STAGING', seat: 0 }, 0)
		const out = resolveOp(s, ID('bur07'), 1)
		expect(out.players[0]!.resources.DIL).toBe(2)
		expect(out.cards[ID('inert')]!.resourceTokens.DIL).toBe(1)
	})

	it('1BUR10 control: recrystallize ALL parked DIL, log 1BUR02', () => {
		let s = withParkedDilithium(fresh(), 5)
		s = place(
			s,
			real('1BUR10/26'),
			ID('tz'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		const out = resolveOp(s, ID('tz'), 1)
		expect(out.players[0]!.resources.DIL).toBe(5)
		expect(out.cards[ID('inert')]!.zone).toEqual({ k: 'LOG', seat: 0 })
		expect(out.players[0]!.modifiers.some((m) => m.id === '1BUR02')).toBe(false)
	})
})

describe('1SIS13: free play THE drawn SHIP', () => {
	it('the SHIP drawn from the Discard pile is the one free played', () => {
		let s = setResources(fresh(), 0, 'DIL', 1)
		s = setSpecialty(s, 0, 'MILITARY', 5)
		s = place(s, real('1SIS13/25'), ID('ob'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'sbShipLat5', ID('handShip'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'sbShipLat1', ID('discShip'), { k: 'DISCARD', seat: 0 }, 0)
		s = place(s, 'sbPlain', ID('top'), { k: 'DRAW', seat: 0 }, 0)
		const out = resolveOp(s, ID('ob'), 1)
		expect(out.cards[ID('discShip')]!.zone).toEqual({ k: 'STAGING', seat: 0 })
		expect(out.cards[ID('handShip')]!.zone).toEqual({ k: 'HAND', seat: 0 })
		expect(out.players[0]!.resources.LAT).toBe(1)
		expect(out.cards[ID('top')]!.zone).toEqual({ k: 'HAND', seat: 0 }) // then draw
	})
})

describe('"Draw 2 cards and discard one of them" only offers the drawn cards', () => {
	for (const [label, cardId] of [
		['1BUR16', '1BUR16/26'],
		['1BUR19', '1BUR19/26'],
	] as const) {
		it(label, () => {
			let s = fresh()
			s = place(s, real(cardId), ID('dir'), { k: 'STAGING', seat: 0 }, 0)
			s = place(s, 'sbPlain', ID('old'), { k: 'HAND', seat: 0 }, 0)
			s = place(s, 'sbPlain', ID('d1'), { k: 'DRAW', seat: 0 }, 0)
			s = place(s, 'sbPlain', ID('d2'), { k: 'DRAW', seat: 0 }, 0)
			let offered: unknown[] = []
			const out = resolveOp(s, ID('dir'), 0, (c) => {
				if (c.k === 'CHOOSE_CARDS' && c.prompt === 'Discard cards') {
					offered = [...c.candidates]
					return [c.candidates[0]]
				}
				return undefined
			})
			expect(offered).toEqual([ID('d1'), ID('d2')])
			expect(out.cards[ID('old')]!.zone).toEqual({ k: 'HAND', seat: 0 })
		})
	}

	it('1BUR26 (TIME TRAVEL branch)', () => {
		register([
			makeDef({
				id: 'sbTT',
				suit: 'PERSON',
				traits: ['TIME_TRAVEL'],
				operations: [],
			}),
		])
		let s = fresh()
		s = place(s, real('1BUR26/26'), ID('inc'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'sbTT', ID('tt'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		s = place(s, 'sbPlain', ID('old'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'sbPlain', ID('d1'), { k: 'DRAW', seat: 0 }, 0)
		s = place(s, 'sbPlain', ID('d2'), { k: 'DRAW', seat: 0 }, 0)
		let offered: unknown[] = []
		const out = resolveOp(s, ID('inc'), 1, (c) => {
			if (c.k === 'CHOOSE_CARDS' && c.prompt === 'Discard cards') {
				offered = [...c.candidates]
				return [c.candidates[0]]
			}
			return undefined
		})
		expect(offered).toEqual([ID('d1'), ID('d2')])
		expect(out.cards[ID('old')]!.zone).toEqual({ k: 'HAND', seat: 0 })
	})
})

describe('1BUR14: beam this card and another card to 1BUR15', () => {
	it('Grudge itself goes, plus one card from hand', () => {
		let s = fresh()
		s = place(s, real('1BUR15/26'), ID('book'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, real('1BUR14/26'), ID('grudge'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'sbPlain', ID('other'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'sbPlain', ID('staged'), { k: 'STAGING', seat: 0 }, 0)
		const out = resolveOp(s, ID('grudge'), 0)
		expect(out.cards[ID('grudge')]!.zone).toEqual({
			k: 'BEAMED',
			host: ID('book'),
		})
		expect(out.cards[ID('other')]!.zone).toEqual({
			k: 'BEAMED',
			host: ID('book'),
		})
		expect(out.cards[ID('staged')]!.zone).toEqual({ k: 'STAGING', seat: 0 })
	})
})
