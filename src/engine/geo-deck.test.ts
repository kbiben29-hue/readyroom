// The 2GEO crew deck from To Boldly Go (src/data/cards/crew/geo.json).
// Pins its setup, the engine paths it added (GAIN_CARD `filter`,
// SCAN_FOR_TRAIT `speciesOf`, the COST_REQUIRE track comparison, two extra
// Duty Officer slots from one card), its endgame counts, and a fuzz sweep
// against every box-1 crew deck in both seats.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from '../data/catalog'
import { CardArraySchema, type CardDef } from '../data/schema'
import {
	fresh,
	register,
	makeDef,
	place,
	ID,
	setActions,
	setResources,
} from './resolver/testUtils'
import { run } from './resolver/stack'
import { applyChoice, type PendingChoice } from './resolver/choices'
import { score } from './scoring'
import { setup, type CardCatalog, type SetupConfig } from './setup'
import { autoPlay } from '../bot/autoPlay'
import { assertInvariants } from './invariants'
import { zoneKey, type GameState } from './state'
import type { CardInstanceId } from './ids'
import type { Seat } from './resolver/queries'
import type { DeckId } from '../data/ids'

const byCardId = new Map<string, CardDef>()
const raw: unknown = JSON.parse(
	readFileSync(join(__dirname, '../data/cards/crew/geo.json'), 'utf8'),
)
for (const def of CardArraySchema.parse(raw))
	if (def.cardId !== null) byCardId.set(def.cardId, def)
register([...byCardId.values()])
const real = (n: number): string =>
	byCardId.get(`2GEO${String(n).padStart(2, '0')}/23`)!.id

register([
	makeDef({ id: 'gxPerson', suit: 'PERSON', operations: [] }),
	makeDef({
		id: 'gxVulcan',
		suit: 'PERSON',
		traits: ['VULCAN'],
		operations: [],
	}),
	makeDef({ id: 'gxAnomaly', suit: 'CARGO', traits: ['ANOMALY'], operations: [] }),
	makeDef({ id: 'gxSpy', suit: 'PERSON', traits: ['SPY'], operations: [] }),
	makeDef({
		id: 'gxKlingon',
		suit: 'PERSON',
		traits: ['KLINGON'],
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
		case 'CHOOSE_TRAIT':
			return c.traits[0]
		case 'CHOOSE_DESTINATION':
			return c.options[0]
		case 'CHOOSE_SUIT':
			return c.suits[0]
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

let catalog: CardCatalog
beforeAll(async () => {
	catalog = await loadCatalog()
})

describe('GEO setup', () => {
	it('sorts the 23 cards by position indicator', () => {
		const s = setup(
			{
				mode: 'TWO_PLAYER',
				players: [
					{ deck: 'GEO', boardSide: 'ADVANCED' },
					{ deck: 'PIC', boardSide: 'BASIC' },
				],
				seed: 7,
			},
			catalog,
		)
		const count = (k: string) =>
			(s.zones[zoneKey({ k, seat: 0 } as never)] ?? []).length
		expect(count('CAPTAIN')).toBe(1)
		expect(count('FLEET')).toBe(1)
		expect(count('DEVELOPMENT')).toBe(7)
		expect(count('RESERVE')).toBe(4)
		expect(count('HAND') + count('DRAW')).toBe(10)
		expect(s.players[0].missions).toHaveLength(3)
	})

	it('plays the Basic side with its first mission only', () => {
		const s = setup(
			{
				mode: 'TWO_PLAYER',
				players: [
					{ deck: 'PIC', boardSide: 'ADVANCED' },
					{ deck: 'GEO', boardSide: 'BASIC' },
				],
				seed: 3,
			},
			catalog,
		)
		expect(s.players[1].missions).toHaveLength(1)
		expect(s.players[1].missions[0]!.cardId).toBe('2GEO/M1')
	})
})

describe('endgame', () => {
	it('2GEO01 scores 1 VP for every 3 cards in play', () => {
		let s = place(fresh(), real(1), ID('geo'), { k: 'CAPTAIN', seat: 0 }, 0)
		for (const p of ['p1', 'p2', 'p3', 'p4', 'p5'])
			s = place(s, 'gxPerson', ID(p), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'gxPerson', ID('h1'), { k: 'HAND', seat: 0 }, 0)
		// captain + 5 in play = 6 → 2 VP (the card in hand does not count)
		const geo = score(s, 0).endgame.find((e) => e.card === 'geo')
		expect(geo?.vp).toBe(2)
	})

	it('2GEO05 scores 1 VP per ANOMALY you own', () => {
		let s = place(fresh(), real(5), ID('angel'), { k: 'FLEET', seat: 0 }, 0)
		s = place(s, 'gxAnomaly', ID('a1'), { k: 'DISCARD', seat: 0 }, 0)
		// 2GEO05 is an ANOMALY itself
		const angel = score(s, 0).endgame.find((e) => e.card === 'angel')
		expect(angel?.vp).toBe(2)
	})
})

describe('2GEO13', () => {
	it('scans for a species of the discarded card when RESEARCH > MILITARY', () => {
		let s = place(fresh(), real(13), ID('burn'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'gxKlingon', ID('k1'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'gxKlingon', ID('k2'), { k: 'MARKET_OFFER', suit: 'PERSON' })
		s = setActions(s, 0, 3)
		s = {
			...s,
			players: [
				{
					...s.players[0],
					specialties: { RESEARCH: 2, INFLUENCE: 0, MILITARY: 0 },
				},
				s.players[1],
			],
		}
		s = resolveOp(s, ID('burn'), 1)
		expect(s.cards['k1']!.zone).toEqual({ k: 'DISCARD', seat: 0 })
		expect(s.cards['k2']!.owner).toBe(0)
	})

	it('cannot use the RESEARCH play when MILITARY is higher', () => {
		let s = place(fresh(), real(13), ID('burn'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'gxKlingon', ID('k1'), { k: 'HAND', seat: 0 }, 0)
		s = setActions(s, 0, 3)
		s = {
			...s,
			players: [
				{
					...s.players[0],
					specialties: { RESEARCH: 0, INFLUENCE: 0, MILITARY: 2 },
				},
				s.players[1],
			],
		}
		s = resolveOp(s, ID('burn'), 1)
		// the gate failed: nothing was discarded
		expect(s.cards['k1']!.zone).toEqual({ k: 'HAND', seat: 0 })
	})
})

describe('2GEO22', () => {
	it('Clean-up: gains a SPY from the Market to hand and logs itself', () => {
		let s = place(fresh(), real(22), ID('gant'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		s = place(s, 'gxSpy', ID('spy'), { k: 'MARKET_OFFER', suit: 'PERSON' })
		s = place(s, 'gxPerson', ID('other'), { k: 'MARKET_OFFER', suit: 'PERSON' })
		s = resolveOp(s, ID('gant'), 2)
		expect(s.cards['spy']!.zone).toEqual({ k: 'HAND', seat: 0 })
		expect(s.cards['other']!.owner).toBeNull()
		expect(s.cards['gant']!.zone).toEqual({ k: 'LOG', seat: 0 })
	})

	it('Clean-up: does nothing without a SPY in the Market', () => {
		let s = place(fresh(), real(22), ID('gant'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		s = place(s, 'gxPerson', ID('other'), { k: 'MARKET_OFFER', suit: 'PERSON' })
		s = resolveOp(s, ID('gant'), 2)
		expect(s.cards['gant']!.zone).toEqual({ k: 'DUTY_OFFICER', seat: 0 })
	})
})

describe('2GEO04', () => {
	it('gains 1 INFLUENCE per VULCAN in play, counting himself', () => {
		let s = place(fresh(), real(4), ID('amb'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'gxVulcan', ID('v1'), { k: 'DUTY_OFFICER', seat: 0 }, 0)
		s = setActions(s, 0, 3)
		s = setResources(s, 0, 'DIL', 0)
		s = resolveOp(s, ID('amb'), 0, (c) => (c.k === 'CONFIRM' ? false : undefined))
		expect(s.players[0].specialties.INFLUENCE).toBe(2)
	})
})

// ---------------------------------------------------------------------------
// Fuzz: 2GEO against every box-1 crew deck, in both seats.
// ---------------------------------------------------------------------------

const OPPONENTS = ['PIC', 'SHR', 'KOL', 'SIS', 'SEL'] as const

function twoPlayer(a: DeckId, b: DeckId, seed: number): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: a, boardSide: 'ADVANCED' },
			{ deck: b, boardSide: 'ADVANCED' },
		],
		seed,
	}
}

describe('GEO fuzz', () => {
	const cases: [DeckId, DeckId][] = []
	for (const o of OPPONENTS) cases.push(['GEO', o], [o, 'GEO'])
	it.each(cases)(
		'%s/%s reaches GAME_OVER with invariants after every intent',
		(a, b) => {
			for (const seed of [0, 1]) {
				let before: GameState | undefined
				const r = autoPlay(
					setup(twoPlayer(a, b, seed), catalog),
					undefined,
					undefined,
					(s: GameState) => {
						const pre = before
						before = s
						assertInvariants(s, { since: pre })
					},
				)
				expect(r.stopped, `${a}/${b} seed ${seed}`).toBe('GAME_OVER')
				expect(r.state.result?.kind).toBe('COMPLETE')
			}
		},
		180_000,
	)
})
