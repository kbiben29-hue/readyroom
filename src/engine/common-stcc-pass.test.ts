// Box-1 common cards, STCC re-verification pass (docs/card-rulings.md 044):
// each test loads the REAL card definition and resolves it through the stack,
// asserting the behaviour the STCC text describes.

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
	setSpecialty,
} from './resolver/testUtils'
import { run } from './resolver/stack'
import { applyChoice, type PendingChoice } from './resolver/choices'
import { zoneKey, type GameState, type Frame } from './state'
import type { CardInstanceId } from './ids'
import type { Seat } from './resolver/queries'
import type { Effect } from './resolver/nodes'

const byCardId = new Map<string, CardDef>()
for (const f of [
	'cargo',
	'person',
	'ally',
	'encounter',
	'incident',
	'location',
]) {
	const raw: unknown = JSON.parse(
		readFileSync(join(__dirname, `../data/cards/common/${f}.json`), 'utf8'),
	)
	for (const def of CardArraySchema.parse(raw))
		if (def.cardId !== null) byCardId.set(def.cardId, def)
}
register([...byCardId.values()])
const real = (cardId: string): string => byCardId.get(cardId)!.id
const def = (cardId: string): CardDef => byCardId.get(cardId)!

register([
	makeDef({ id: 'cpPlain', suit: 'PERSON', operations: [] }),
	makeDef({
		id: 'cpEng',
		suit: 'PERSON',
		traits: ['ENGINEER'],
		operations: [],
	}),
	makeDef({
		id: 'cpFerengi',
		suit: 'PERSON',
		traits: ['FERENGI'],
		operations: [],
	}),
	makeDef({
		id: 'cpFerBiz',
		suit: 'PERSON',
		traits: ['FERENGI', 'BUSINESS'],
		operations: [],
	}),
	makeDef({
		id: 'cpVulcan',
		suit: 'PERSON',
		traits: ['VULCAN'],
		operations: [],
	}),
	makeDef({
		id: 'cpTime',
		suit: 'CARGO',
		traits: ['TIME_TRAVEL'],
		operations: [],
	}),
	makeDef({ id: 'cpLoc', suit: 'LOCATION', operations: [] }),
	makeDef({ id: 'cpShip', suit: 'SHIP', operations: [] }),
])

type Answer = (c: PendingChoice) => unknown

/** Accept every MAY, take the first candidate/option, reactions: none. */
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
			return []
		default:
			throw new Error(`test driver: unhandled choice ${c.k}`)
	}
}

function drive(state: GameState, answer: Answer = auto): GameState {
	let s = run(state)
	let guard = 0
	while (s.pendingChoice !== null) {
		const c = s.pendingChoice
		s = run(
			applyChoice(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: c.id,
				selection: answer(c) ?? auto(c),
			}),
		)
		if (++guard > 100) throw new Error('drive: too many choices')
	}
	return s
}

const push = (state: GameState, frame: Frame): GameState => ({
	...state,
	stack: [...state.stack, frame],
})
const resolveOp = (
	state: GameState,
	card: CardInstanceId,
	opIndex: number,
	answer?: Answer,
): GameState =>
	drive(
		push(state, {
			k: 'OPERATION',
			card,
			opIndex,
			ctx: { actor: 0, source: card, bindings: {} },
			phase: 0,
		}),
		answer,
	)
const resolveEffect = (
	state: GameState,
	node: Effect,
	answer?: Answer,
): GameState =>
	drive(
		push(state, {
			k: 'EFFECT',
			node,
			ctx: { actor: 0, source: ID('driver'), bindings: {} },
			ip: 0,
		}),
		answer,
	)

const zone = (s: GameState, k: string, seat: Seat): CardInstanceId[] =>
	s.zones[zoneKey({ k, seat } as Parameters<typeof zoneKey>[0])] ?? []

function deck(s: GameState, seat: Seat, n: number, prefix = 'd'): GameState {
	for (let i = 0; i < n; i++)
		s = place(s, 'cpPlain', ID(`${prefix}${i}`), { k: 'DRAW', seat }, seat)
	return s
}

describe('1CAR04: 1 LAT for each FERENGI and each BUSINESS (max 5)', () => {
	it('a FERENGI BUSINESS counts twice; 3+ LAT gained → 1 GLO', () => {
		let s = setSpecialty(fresh(), 0, 'INFLUENCE', 5)
		s = place(s, real('1CAR04/16'), ID('wine'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'cpFerBiz', ID('fb'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		s = place(s, 'cpFerengi', ID('f'), { k: 'FLEET', seat: 0 }, 0)
		s = resolveOp(s, ID('wine'), 0)
		// the Wine itself (FERENGI, in Staging) + FERENGI BUSINESS ×2 + FERENGI
		expect(s.players[0].resources.LAT).toBe(4)
		expect(s.players[0].resources.GLO).toBe(1)
	})

	it('the Wine alone: 1 LAT, no GLO; capped at 5', () => {
		let s = setSpecialty(fresh(), 0, 'INFLUENCE', 5)
		s = place(s, real('1CAR04/16'), ID('wine'), { k: 'STAGING', seat: 0 }, 0)
		const alone = resolveOp(s, ID('wine'), 0)
		expect(alone.players[0].resources.LAT).toBe(1)
		expect(alone.players[0].resources.GLO).toBe(0)
		for (const i of [0, 1, 2])
			s = place(s, 'cpFerBiz', ID(`fb${i}`), { k: 'FLEET', seat: 0 }, 0)
		s = resolveOp(s, ID('wine'), 0)
		expect(s.players[0].resources.LAT).toBe(5)
		expect(s.players[0].resources.GLO).toBe(1)
	})
})

describe('1CAR05: draw 2, then one of those two goes on top', () => {
	it('only the two drawn cards are offered; the chosen one goes on top', () => {
		let s = deck(fresh(), 0, 4)
		s = place(s, real('1CAR05/16'), ID('fs'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'cpEng', ID('eng'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'cpPlain', ID('keep'), { k: 'HAND', seat: 0 }, 0)
		const offered: CardInstanceId[][] = []
		s = resolveOp(s, ID('fs'), 2, (c) => {
			if (c.k === 'CHOOSE_CARDS' && c.candidates.includes(ID('d0'))) {
				offered.push([...c.candidates])
				return [ID('d1')]
			}
			return undefined
		})
		expect(offered).toEqual([[ID('d0'), ID('d1')]])
		expect(zone(s, 'DRAW', 0)[0]).toBe(ID('d1'))
		expect(zone(s, 'HAND', 0)).toEqual(
			expect.arrayContaining([ID('keep'), ID('d0')]),
		)
	})
})

describe('1CAR06: both PLAY operations cost an [action] (STCC)', () => {
	it('op 1 costsAction', () => {
		expect(def('1CAR06/16').operations.map((o) => o.costsAction)).toEqual([
			true,
			true,
		])
	})
})

describe('1CAR08: draw a card for each VULCAN in play (excluding this card, max 5)', () => {
	it('another 1CAR08 counts, the resolving one does not', () => {
		let s = deck(fresh(), 0, 6)
		s = place(s, real('1CAR08/16'), ID('1CAR08'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, real('1CAR08/16'), ID('car082'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'cpVulcan', ID('v'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		// decline "put a card on top of your deck to gain 1 GLO"
		s = resolveOp(s, ID('1CAR08'), 0, (c) =>
			c.k === 'CONFIRM' ? false : undefined,
		)
		expect(zone(s, 'HAND', 0)).toHaveLength(2)
	})
})

describe('1PER13: beam onto a SHIP, then send an AWAY TEAM where that SHIP is', () => {
	it('the player picks the ship; the Away Team goes to that ship’s Location', () => {
		let s = setActions(fresh(), 0, 3)
		s = place(s, 'cpLoc', ID('L0'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		s = place(s, 'cpLoc', ID('N0'), { k: 'NEUTRAL_ZONE', slot: 0 }, null)
		s = place(s, 'cpShip', ID('s0'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('L0'),
		})
		s = place(s, 'cpShip', ID('s1'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('N0'),
		})
		s = {
			...s,
			players: s.players.map((p) => ({
				...p,
				awayTeamsInPool: 3,
			})) as GameState['players'],
		}
		s = place(s, real('1PER13/25'), ID('1PER13'), { k: 'STAGING', seat: 0 }, 0)
		const hosts: CardInstanceId[][] = []
		s = resolveOp(s, ID('1PER13'), 0, (c) => {
			if (c.k === 'CHOOSE_CARDS' && c.candidates.includes(ID('s1'))) {
				hosts.push([...c.candidates])
				return [ID('s1')]
			}
			return undefined
		})
		expect(hosts).toEqual([[ID('s0'), ID('s1')]])
		expect(s.cards['1PER13']!.zone).toEqual({ k: 'BEAMED', host: ID('s1') })
		expect(s.awayTeamsAt['N0']?.[0]).toBe(1)
		expect(s.awayTeamsAt['L0']?.[0] ?? 0).toBe(0)
	})
})

describe('1PER18: beaming itself onto a deployed SHIP is mandatory', () => {
	it('beams itself without asking', () => {
		let s = setSpecialty(setActions(fresh(), 0, 3), 0, 'RESEARCH', 6)
		s = place(s, 'cpShip', ID('s0'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, real('1PER18/25'), ID('1PER18'), { k: 'STAGING', seat: 0 }, 0)
		const asked: string[] = []
		s = resolveOp(s, ID('1PER18'), 1, (c) => {
			asked.push(c.k)
			return undefined
		})
		expect(asked).toEqual([])
		expect(s.cards['1PER18']!.zone).toEqual({ k: 'BEAMED', host: ID('s0') })
	})
})

describe('1ALL10: "Dismiss an opponent Duty Officer" — you choose', () => {
	it('the dismissal choice belongs to seat 0', () => {
		let s = setActions(fresh(), 0, 3)
		s = place(s, real('1ALL10/13'), ID('leth'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'cpPlain', ID('o1'), { k: 'DUTY_OFFICER', seat: 1 }, 1)
		s = place(s, 'cpEng', ID('o2'), { k: 'DUTY_OFFICER', seat: 1 }, 1)
		const seats: Seat[] = []
		s = resolveOp(s, ID('leth'), 0, (c) => {
			if (c.k === 'CHOOSE_CARDS' && c.candidates.includes(ID('o2'))) {
				seats.push(c.seat)
				return [ID('o2')]
			}
			return c.k === 'CONFIRM' ? false : undefined
		})
		expect(seats).toEqual([0])
		expect(zone(s, 'DUTY_OFFICER', 1)).toEqual([ID('o1')])
	})
})

describe('1ALL13: 1 LAT and 2 DIL for each controlled LOCATION', () => {
	it('two Locations → 2 LAT and 4 DIL', () => {
		let s = setActions(fresh(), 0, 3)
		s = place(s, 'cpLoc', ID('L0'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		s = place(s, 'cpLoc', ID('L1'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		s = place(s, real('1ALL13/13'), ID('thol'), { k: 'STAGING', seat: 0 }, 0)
		s = resolveOp(s, ID('thol'), 0, (c) =>
			c.k === 'CONFIRM' ? false : undefined,
		)
		expect(s.players[0].resources.LAT).toBe(2)
		expect(s.players[0].resources.DIL).toBe(4)
	})
})

describe('1INC05: "draw 2 cards and discard one of THEM"', () => {
	it('a card already in hand is never offered', () => {
		let s = deck(setActions(fresh(), 0, 3), 0, 3)
		s = place(s, 'cpTime', ID('tt'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, real('1INC05/6'), ID('inc'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'cpPlain', ID('keep'), { k: 'HAND', seat: 0 }, 0)
		const offered: CardInstanceId[][] = []
		s = resolveOp(s, ID('inc'), 1, (c) => {
			if (c.k === 'CHOOSE_CARDS') offered.push([...c.candidates])
			return undefined
		})
		expect(offered).toEqual([[ID('d0'), ID('d1')]])
		expect(zone(s, 'HAND', 0)).toContain(ID('keep'))
		expect(zone(s, 'DISCARD', 0)).toEqual([ID('d0')])
	})
})

describe('1LOC01: logged → warp all SHIPs to ONE other LOCATION first', () => {
	it('ships at 1LOC01 are warped away before the log dismisses them; all share one destination', () => {
		let s = deck(fresh(), 0, 3)
		s = place(
			s,
			real('1LOC01/20'),
			ID('amar'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		s = place(s, 'cpLoc', ID('L1'), { k: 'LOCATION_AREA', seat: 0 }, 0)
		s = place(s, 'cpLoc', ID('N0'), { k: 'NEUTRAL_ZONE', slot: 0 }, null)
		s = place(s, 'cpShip', ID('s0'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('amar'),
		})
		s = place(s, 'cpShip', ID('s1'), { k: 'FLEET', seat: 0 }, 0, {
			shipTokenAt: ID('L1'),
		})
		const dests: CardInstanceId[][] = []
		s = resolveEffect(
			s,
			{
				k: 'LOG',
				target: {
					zones: [{ k: 'LOCATION_AREA', seat: 0 }],
					filter: { ids: ['1LOC01-20'] },
				},
			},
			(c) => {
				if (c.k === 'CHOOSE_CARDS' && c.candidates.includes(ID('s0')))
					return [ID('s0')]
				if (c.k === 'CHOOSE_LOCATION') {
					dests.push([...c.candidates])
					return ID('N0')
				}
				return undefined
			},
		)
		// the destination never offers 1LOC01 itself
		expect(dests[0]).not.toContain(ID('amar'))
		expect(s.cards['amar']!.zone).toEqual({ k: 'LOG', seat: 0 })
		expect(s.cards['s0']!.zone.k).toBe('FLEET')
		expect(s.cards['s0']!.shipTokenAt).toBe(ID('N0'))
		expect(s.cards['s1']!.shipTokenAt).toBe(ID('N0'))
		expect(zone(s, 'HAND', 0)).toHaveLength(2)
	})
})

describe('1LOC04: CONTROL beams ANY number of PERSON', () => {
	it('five PERSONs in hand can all be beamed', () => {
		let s = fresh()
		s = place(
			s,
			real('1LOC04/20'),
			ID('baku'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		for (let i = 0; i < 5; i++)
			s = place(s, 'cpPlain', ID(`p${i}`), { k: 'HAND', seat: 0 }, 0)
		s = resolveOp(s, ID('baku'), 0)
		expect(s.zones['BEAMED:baku']).toHaveLength(5)
	})
})

describe('1LOC14: "You may log a card" = a card you have in play', () => {
	it('offers in-play cards, never hand/Discard cards or the Captain', () => {
		let s = fresh()
		s = place(
			s,
			real('1LOC14/20'),
			ID('ma'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		s = place(s, 'cpPlain', ID('h'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'cpPlain', ID('dis'), { k: 'DISCARD', seat: 0 }, 0)
		s = place(s, 'cpPlain', ID('stg'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'cpPlain', ID('do'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		s = place(s, 'cpPlain', ID('cap'), { k: 'CAPTAIN', seat: 0 }, 0)
		let offered: CardInstanceId[] = []
		s = resolveOp(s, ID('ma'), 0, (c) => {
			if (c.k === 'CHOOSE_CARDS' && c.candidates.includes(ID('stg'))) {
				offered = [...c.candidates]
				return [ID('stg')]
			}
			return c.k === 'CONFIRM' && offered.length > 0 ? false : undefined
		})
		expect(offered).toEqual(expect.arrayContaining([ID('stg'), ID('do')]))
		for (const no of ['h', 'dis', 'cap']) expect(offered).not.toContain(ID(no))
		expect(s.cards['stg']!.zone).toEqual({ k: 'LOG', seat: 0 })
	})
})
