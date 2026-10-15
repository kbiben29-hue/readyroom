// Regression tests for the KOL/SEL STCC re-verification pass. Each test
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
	place,
	ID,
	setActions,
	setResources,
	setSpecialty,
} from './resolver/testUtils'
import { run } from './resolver/stack'
import { applyChoice, type PendingChoice } from './resolver/choices'
import { canPlay } from './queries/legality'
import { resolveQuery } from './queries/resolveQuery'
import { zoneKey, type GameState } from './state'
import type { CardInstanceId } from './ids'
import type { Seat } from './resolver/queries'

const byCardId = new Map<string, CardDef>()
for (const f of ['crew/kol', 'crew/sel', 'crew/bur']) {
	const raw: unknown = JSON.parse(
		readFileSync(join(__dirname, `../data/cards/${f}.json`), 'utf8'),
	)
	for (const def of CardArraySchema.parse(raw))
		if (def.cardId !== null) byCardId.set(def.cardId, def)
}
register([...byCardId.values()])
const real = (cardId: string): string => byCardId.get(cardId)!.id

register([
	makeDef({ id: 'ksPlain', suit: 'PERSON', operations: [] }),
	makeDef({ id: 'ksShip', suit: 'SHIP', operations: [] }),
	makeDef({ id: 'ksLoc', suit: 'LOCATION', operations: [] }),
	makeDef({
		id: 'ksKlingon',
		suit: 'PERSON',
		traits: ['KLINGON'],
		operations: [],
	}),
	makeDef({
		id: 'ksStarfleet',
		suit: 'PERSON',
		traits: ['STARFLEET'],
		operations: [],
	}),
	makeDef({
		id: 'ksMilInf',
		suit: 'PERSON',
		skills: ['SKILL_MILITARY', 'SKILL_INFLUENCE', 'SKILL_INFLUENCE'],
		operations: [],
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
	actor: Seat = 0,
): GameState {
	return drive(
		{
			...state,
			stack: [
				...state.stack,
				{
					k: 'OPERATION',
					card,
					opIndex,
					ctx: { actor, source: card, bindings: {} },
					phase: 0,
				},
			],
		},
		answer,
	)
}

const zone = (s: GameState, k: string, seat: Seat): CardInstanceId[] =>
	s.zones[zoneKey({ k, seat } as Parameters<typeof zoneKey>[0])] ?? []

describe('1SEL03: "force your opponent to dismiss a SHIP"', () => {
	it("the opponent dismisses one of THEIR deployed ships, never SEL's", () => {
		let s = setResources(fresh(), 0, 'DIL', 2)
		s = place(s, real('1SEL03/24'), ID('sel03'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'ksShip', ID('mine'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'ksShip', ID('theirs'), { k: 'FLEET', seat: 1 }, 1)
		s = place(s, 'ksShip', ID('staged'), { k: 'STAGING', seat: 1 }, 1)
		s = place(s, 'ksPlain', ID('d0'), { k: 'DRAW', seat: 0 }, 0)
		const pickers: Seat[] = []
		s = resolveOp(s, ID('sel03'), 2, (c) => {
			if (c.k === 'CHOOSE_CARDS') pickers.push(c.seat)
			return undefined
		})
		expect(zone(s, 'FLEET', 0).sort()).toEqual([ID('mine'), ID('sel03')])
		expect(zone(s, 'DISCARD', 1)).toEqual([ID('theirs')])
		expect(zone(s, 'STAGING', 1)).toEqual([ID('staged')])
		expect(zone(s, 'HAND', 0)).toEqual([ID('d0')])
		expect(pickers.every((p) => p === 1)).toBe(true)
	})
})

describe('1KOL03: opponent SHIP count deployed (2+) condition', () => {
	const proto = (theirFleet: number, theirStaging: number) => {
		let s = setActions(fresh(), 0, 3)
		s = place(s, real('1KOL03/24'), ID('proto'), { k: 'STAGING', seat: 0 }, 0)
		for (let i = 0; i < theirFleet; i++)
			s = place(s, 'ksShip', ID(`f${i}`), { k: 'FLEET', seat: 1 }, 1)
		for (let i = 0; i < theirStaging; i++)
			s = place(s, 'ksShip', ID(`st${i}`), { k: 'STAGING', seat: 1 }, 1)
		s = place(s, 'ksPlain', ID('inc'), { k: 'INCIDENT_DECK' })
		return s
	}

	it('a SHIP in their Staging Area is not deployed: no force with 1 + 1', () => {
		const s = resolveOp(proto(1, 1), ID('proto'), 0)
		expect(zone(s, 'FLEET', 1)).toEqual([ID('f0')])
		expect(s.cards[ID('inc')]!.owner).toBeNull()
	})

	it('with 2 deployed they dismiss one of their own deployed SHIPs', () => {
		const s = resolveOp(proto(2, 0), ID('proto'), 0, (c) =>
			c.k === 'CHOOSE_OPTION'
				? { key: c.options.find((o) => o.label.startsWith('Dismiss'))!.key }
				: undefined,
		)
		expect(zone(s, 'FLEET', 1)).toHaveLength(1)
		expect(zone(s, 'DISCARD', 1)).toHaveLength(1)
		expect(zone(s, 'FLEET', 0)).toEqual([ID('proto')])
	})
})

describe('1KOL04: "Dismiss a KLINGON Duty Officer to gain 4 {GLO}" is a cost', () => {
	const sword = (klingonDO: boolean) => {
		let s = setSpecialty(setActions(fresh(), 0, 3), 0, 'MILITARY', 9)
		s = place(s, real('1KOL04/24'), ID('sword'), { k: 'HAND', seat: 0 }, 0)
		if (klingonDO)
			s = place(s, 'ksKlingon', ID('do'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		return s
	}

	it('cannot be played without a KLINGON Duty Officer (rules/12 §12.1)', () => {
		expect(canPlay(sword(false), 0, ID('sword')).ok).toBe(false)
	})

	it('dismisses the Duty Officer, gains 4 {GLO} and logs itself', () => {
		let s = sword(true)
		expect(canPlay(s, 0, ID('sword')).ok).toBe(true)
		s = {
			...s,
			cards: {
				...s.cards,
				[ID('sword')]: {
					...s.cards[ID('sword')]!,
					zone: { k: 'STAGING', seat: 0 },
				},
			},
			zones: {
				...s.zones,
				'HAND:0': [],
				'STAGING:0': [ID('sword')],
			},
		}
		s = resolveOp(s, ID('sword'), 0)
		expect(zone(s, 'DISCARD', 0)).toEqual([ID('do')])
		expect(s.players[0].resources.GLO).toBe(4)
		expect(zone(s, 'LOG', 0)).toEqual([ID('sword')])
	})
})

describe('1KOL17: logging + dismissing two deployed SHIPs is a cost', () => {
	it('cannot be played with fewer than two deployed SHIPs', () => {
		let s = setActions(fresh(), 0, 3)
		s = place(s, real('1KOL17/24'), ID('gdtd'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'ksShip', ID('s1'), { k: 'FLEET', seat: 0 }, 0)
		expect(canPlay(s, 0, ID('gdtd')).ok).toBe(false)
		s = place(s, 'ksShip', ID('s2'), { k: 'FLEET', seat: 0 }, 0)
		expect(canPlay(s, 0, ID('gdtd')).ok).toBe(true)
	})
})

describe('1SEL14: a dismissal makes the opponent discard a card', () => {
	const sel14 = (withBook: boolean) => {
		let s = setActions(setResources(fresh(), 0, 'DIL', 2), 0, 3)
		s = place(s, real('1SEL14/24'), ID('tom'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'ksStarfleet', ID('sf'), { k: 'DUTY_OFFICER', seat: 1 }, 1)
		s = place(s, 'ksPlain', ID('h1'), { k: 'HAND', seat: 1 }, 1)
		if (withBook) {
			s = place(s, real('1BUR15/26'), ID('book'), { k: 'FLEET', seat: 1 }, 1)
			s = place(s, 'ksPlain', ID('bm'), { k: 'BEAMED', host: 'book' }, 1)
		}
		return resolveOp(s, ID('tom'), 0)
	}

	it('a dismissed STARFLEET Duty Officer → they discard', () => {
		const s = sel14(false)
		expect(zone(s, 'DUTY_OFFICER', 1)).toEqual([])
		expect(zone(s, 'HAND', 1)).toEqual([])
	})

	it('the dismissal ignored (1BUR15) → nothing was dismissed, no discard', () => {
		const s = sel14(true)
		expect(zone(s, 'DUTY_OFFICER', 1)).toEqual([ID('sf')])
		expect(zone(s, 'DISCARD', 1)).toEqual([ID('bm')]) // 1BUR15 paid
		expect(zone(s, 'HAND', 1)).toEqual([ID('h1')])
	})

	it('Query.bound accepts a name bound to a list (LET over a Query)', () => {
		let s = place(fresh(), 'ksPlain', ID('a'), { k: 'DISCARD', seat: 1 }, 1)
		s = place(s, 'ksPlain', ID('b'), { k: 'DISCARD', seat: 1 }, 1)
		const q = {
			zones: [{ k: 'DISCARD' as const, seat: 1 as const }],
			seat: 'OPPONENT' as const,
			bound: '$list',
		}
		const ctx = (v: string[]) => ({
			actor: 0 as Seat,
			source: ID('src'),
			bindings: { $list: v },
		})
		expect(resolveQuery(s, q, ctx([ID('b'), ID('zzz')]))).toEqual([ID('b')])
		expect(resolveQuery(s, q, ctx([]))).toEqual([])
	})
})

describe('1SEL22: gain on ONE track per matching Skill icon', () => {
	it('counts only the chosen track (INFLUENCE: 2 of 3 icons)', () => {
		let s = setActions(fresh(), 0, 3)
		s = place(s, real('1SEL22/24'), ID('util'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'ksMilInf', ID('p'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		s = resolveOp(s, ID('util'), 1, (c) =>
			c.k === 'CHOOSE_SPECIALTY' ? 'INFLUENCE' : undefined,
		)
		expect(s.players[0].specialties.INFLUENCE).toBe(2)
		expect(s.players[0].specialties.MILITARY).toBe(0)
	})
})

describe('1SEL24: "your opponent MAY draw a card"', () => {
	it('the opponent can decline the draw', () => {
		let s = place(
			fresh(),
			real('1SEL24/24'),
			ID('rem'),
			{ k: 'STAGING', seat: 0 },
			0,
		)
		s = place(s, 'ksPlain', ID('h0'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'ksPlain', ID('d1'), { k: 'DRAW', seat: 1 }, 1)
		s = place(s, 'ksLoc', ID('nz'), { k: 'NEUTRAL_ZONE', slot: 0 })
		const confirms: Seat[] = []
		s = resolveOp(s, ID('rem'), 0, (c) => {
			if (c.k === 'CHOOSE_OPTION')
				return {
					key: c.options.find((o) => o.label.includes('may draw'))!.key,
				}
			if (c.k === 'CONFIRM') {
				confirms.push(c.seat)
				return false
			}
			return undefined
		})
		expect(confirms).toEqual([1])
		expect(zone(s, 'DRAW', 1)).toEqual([ID('d1')])
		expect(zone(s, 'STAGING', 0)).toEqual([ID('rem')])
	})
})

describe('1SEL07: "[mil9] Take control of this ship\'s (neutral) LOCATION"', () => {
	it('needs no secured Location', () => {
		let s = setSpecialty(fresh(), 0, 'MILITARY', 9)
		s = place(s, 'ksLoc', ID('nz'), { k: 'NEUTRAL_ZONE', slot: 0 })
		s = place(s, real('1SEL07/24'), ID('scim'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('nz'),
		})
		s = resolveOp(s, ID('scim'), 3)
		expect(zone(s, 'LOCATION_AREA', 0)).toEqual([ID('nz')])
	})
})
