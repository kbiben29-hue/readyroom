// The fan-made MAL crew deck (src/data/cards/crew/mal.json, names and text in
// src/data/custom/firefly.json). Pins its setup and the engine paths no box-1
// card exercises: the SHIP_WARPED and INCIDENT_RETURNED reactions, a warp paid
// in either resource, and the endgame counts over beamed PERSONs and owned
// INCIDENTs.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
import { setup } from './setup'
import { zoneKey, type GameState } from './state'
import type { CardInstanceId } from './ids'
import type { Seat } from './resolver/queries'

const byCardId = new Map<string, CardDef>()
const raw: unknown = JSON.parse(
	readFileSync(join(__dirname, '../data/cards/crew/mal.json'), 'utf8'),
)
for (const def of CardArraySchema.parse(raw))
	if (def.cardId !== null) byCardId.set(def.cardId, def)
register([...byCardId.values()])
const real = (n: number): string =>
	byCardId.get(`1MAL${String(n).padStart(2, '0')}/25`)!.id

register([
	makeDef({ id: 'mxPerson', suit: 'PERSON', operations: [] }),
	makeDef({ id: 'mxIncident', suit: 'INCIDENT', vp: -2, operations: [] }),
	makeDef({ id: 'mxLoc', suit: 'LOCATION', operations: [] }),
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

/** Serenity deployed with a Neutral Zone LOCATION to warp to. */
function withSerenity(): GameState {
	let s = place(fresh(), real(2), ID('serenity'), { k: 'FLEET', seat: 0 }, 0, {
		shipTokenAt: null,
	})
	s = place(s, 'mxLoc', ID('loc'), { k: 'NEUTRAL_ZONE', slot: 0 })
	return s
}

describe('MAL setup', () => {
	it('sorts the 25 cards by position indicator', async () => {
		const catalog = await loadCatalog()
		const s = setup(
			{
				mode: 'TWO_PLAYER',
				players: [
					{ deck: 'MAL', boardSide: 'ADVANCED' },
					{ deck: 'PIC', boardSide: 'BASIC' },
				],
				seed: 7,
			},
			catalog,
		)
		const count = (k: string) =>
			(s.zones[zoneKey({ k, seat: 0 } as never)] ?? []).length
		expect(count('FLEET')).toBe(1)
		expect(count('DEVELOPMENT')).toBe(8)
		expect(count('RESERVE')).toBe(5)
		expect(count('HAND') + count('DRAW')).toBe(10)
		expect(s.players[0].missions).toHaveLength(3)
	})
})

describe('Serenity and the pilot', () => {
	it('warps for 1 {LAT} when there is no {DIL}', () => {
		let s = setResources(withSerenity(), 0, 'DIL', 0)
		s = setResources(s, 0, 'LAT', 1)
		s = resolveOp(s, ID('serenity'), 1)
		expect(s.cards['serenity']!.shipTokenAt).toBe('loc')
		expect(s.players[0].resources.LAT).toBe(0)
	})

	it('Hoban Washburne refunds 1 {DIL} after one of your ships warps', () => {
		let s = place(
			withSerenity(),
			real(23),
			ID('wash'),
			{ k: 'DUTY_OFFICER', seat: 0 },
			0,
		)
		s = setResources(s, 0, 'DIL', 1)
		s = setResources(s, 0, 'LAT', 0)
		s = resolveOp(s, ID('serenity'), 1)
		expect(s.cards['serenity']!.shipTokenAt).toBe('loc')
		expect(s.players[0].resources.DIL).toBe(1)
		expect(s.cards['wash']!.exhausted).toBe(true)
	})
})

describe('incidents', () => {
	it('Shepherd Book gains 1 {GLO} after an INCIDENT is returned', () => {
		let s = place(
			fresh(),
			real(5),
			ID('book'),
			{ k: 'DUTY_OFFICER', seat: 0 },
			0,
		)
		s = place(s, real(4), ID('simon'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'mxIncident', ID('inc'), { k: 'HAND', seat: 0 }, 0)
		s = setResources(s, 0, 'GLO', 0)
		s = setActions(s, 0, 3)
		// Simon's play: gain 1 RESEARCH, may return an INCIDENT
		s = resolveOp(s, ID('simon'), 0)
		expect(s.cards['inc']!.zone).toEqual({ k: 'INCIDENT_DECK' })
		expect(s.players[0].resources.GLO).toBe(1)
		expect(s.players[0].specialties.RESEARCH).toBe(1)
	})

	it('Malcolm Reynolds gains 1 {DIL} after taking an INCIDENT', () => {
		let s = place(fresh(), real(1), ID('mal'), { k: 'CAPTAIN', seat: 0 }, 0)
		// two in the deck: taking the last one would trigger the Burn
		s = place(s, 'mxIncident', ID('inc2'), { k: 'INCIDENT_DECK' })
		s = place(s, 'mxIncident', ID('inc'), { k: 'INCIDENT_DECK' })
		s = place(s, real(18), ID('job'), { k: 'STAGING', seat: 0 }, 0)
		s = setResources(s, 0, 'DIL', 0)
		s = setActions(s, 0, 3)
		// Take the Job, first play: take an INCIDENT to gain a CARGO (none in
		// the market here) and 1 {LAT}
		s = resolveOp(s, ID('job'), 0)
		const taken = ['inc', 'inc2'].filter((i) => s.cards[i]!.owner === 0)
		expect(taken).toHaveLength(1)
		expect(s.players[0].resources.DIL).toBe(1)
	})
})

describe('endgame', () => {
	it('Malcolm Reynolds scores 1 VP per PERSON beamed to your SHIPs', () => {
		let s = place(
			withSerenity(),
			real(1),
			ID('mal'),
			{ k: 'CAPTAIN', seat: 0 },
			0,
		)
		for (const p of ['p1', 'p2'])
			s = place(s, 'mxPerson', ID(p), { k: 'BEAMED', host: ID('serenity') }, 0)
		s = place(s, 'mxPerson', ID('p3'), { k: 'HAND', seat: 0 }, 0)
		const mal = score(s, 0).endgame.find((e) => e.card === 'mal')
		expect(mal?.vp).toBe(2)
	})

	it('Miranda scores 1 VP per INCIDENT you own', () => {
		let s = place(
			fresh(),
			real(7),
			ID('miranda'),
			{ k: 'LOCATION_AREA', seat: 0 },
			0,
		)
		s = place(s, 'mxIncident', ID('i1'), { k: 'DISCARD', seat: 0 }, 0)
		s = place(s, 'mxIncident', ID('i2'), { k: 'HAND', seat: 0 }, 0)
		const miranda = score(s, 0).endgame.find((e) => e.card === 'miranda')
		expect(miranda?.vp).toBe(2)
	})
})
