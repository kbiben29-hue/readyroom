// Second Contact (box 3): the expansion's central setup (its commons join
// either base box, the top card of each Market deck goes to the Junk, the
// REWARDS cards form the Reward pile), the SUPPORT operation (a card in hand
// answers its trigger during its owner's Action Step by entering the Staging
// Area) and the Reward-pile pick (TAKE_REWARD).

import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from '../data/catalog'
import { fresh, register, makeDef, place, pushAndRun, op, ID } from './resolver/testUtils'
import { run } from './resolver/stack'
import { applyChoice } from './resolver/choices'
import { setup, type CardCatalog, type SetupConfig } from './setup'
import { zoneKey, type GameState } from './state'
import { score } from './scoring'
import { autoPlay } from '../bot/autoPlay'
import { assertInvariants } from './invariants'
import type { DeckId } from '../data/ids'
import type { GameBox } from '../data/boxes'

let catalog: CardCatalog
beforeAll(async () => {
	catalog = await loadCatalog()
	register(catalog.defs)
})

function game(box: GameBox, sc: boolean, decks: [DeckId, DeckId]): GameState {
	const config: SetupConfig = {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: decks[0], boardSide: 'BASIC' },
			{ deck: decks[1], boardSide: 'BASIC' },
		],
		seed: 11,
		box,
		...(sc ? { expansions: ['SECOND_CONTACT' as const] } : {}),
	}
	return setup(config, catalog)
}

const defOf = (s: GameState, iid: string) => s.cards[iid]!.def
const all = (s: GameState) => Object.values(s.cards).map((c) => c.def)

describe('Second Contact central setup', () => {
	for (const [box, decks] of [
		['ORIGINAL', ['PIC', 'SHR']],
		['TBG', ['GEO', 'SOV']],
	] as const) {
		it(`adds its commons to ${box}`, () => {
			const s = game(box, true, [...decks])
			const sc = all(s).filter((d) => d.startsWith('3'))
			expect(sc).toHaveLength(23)
			expect(s.zones[zoneKey({ k: 'JUNK' })]).toHaveLength(4)
			const reward = s.zones[zoneKey({ k: 'REWARD_PILE' })] ?? []
			expect(reward).toHaveLength(8)
			for (const iid of reward) expect(defOf(s, iid)).toMatch(/^3PER0[1-8]-13$/)
		})
	}

	it('leaves a game without the expansion unchanged', () => {
		const s = game('ORIGINAL', false, ['PIC', 'SHR'])
		expect(all(s).some((d) => d.startsWith('3'))).toBe(false)
		expect(s.zones[zoneKey({ k: 'JUNK' })] ?? []).toHaveLength(0)
		expect(s.zones[zoneKey({ k: 'REWARD_PILE' })] ?? []).toHaveLength(0)
	})
})

register([
	makeDef({
		id: 'scSupport',
		suit: 'PERSON',
		traits: ['LOWER_DECKER'],
		operations: [
			op(
				'SUPPORT',
				{ k: 'GAIN_RESOURCE', res: 'DIL', amount: 2 },
				{ trigger: { on: 'CARD_PROMOTED', filter: { suits: ['PERSON'] } } },
			),
		],
	}),
	makeDef({ id: 'scPerson', suit: 'PERSON', operations: [] }),
	makeDef({ id: 'scReward', suit: 'PERSON', traits: ['CROSSOVER'], operations: [] }),
])

describe('SUPPORT', () => {
	function promoted(): GameState {
		let s = place(fresh(), 'scSupport', ID('sup'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'scPerson', ID('p'), { k: 'HAND', seat: 0 }, 0)
		return pushAndRun(
			s,
			{ k: 'PROMOTE', from: 'HAND', filter: { suits: ['PERSON'] } },
			ID('p'),
			0,
		)
	}

	it('offers the card in hand when its trigger happens, and takes it into Staging', () => {
		let s = promoted()
		// the promote choice (two PERSONs in hand): promote the plain one
		while (s.pendingChoice?.k === 'CHOOSE_CARDS')
			s = run(
				applyChoice(s, {
					t: 'RESOLVE_CHOICE',
					choiceId: s.pendingChoice.id,
					selection: [ID('p')] as never,
				}),
			)
		const c = s.pendingChoice
		expect(c?.k).toBe('OPTIONAL_TRIGGERS')
		if (c?.k !== 'OPTIONAL_TRIGGERS') return
		expect(c.offered.map((r) => r.card)).toEqual([ID('sup')])
		s = run(
			applyChoice(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: c.id,
				selection: c.offered as never,
			}),
		)
		expect(s.cards[ID('sup')]!.zone).toEqual({ k: 'STAGING', seat: 0 })
		expect(s.players[0].resources.DIL).toBe(2)
	})

	it('is not offered outside its owner’s Action Step', () => {
		let s = place(fresh(), 'scSupport', ID('sup'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'scPerson', ID('p'), { k: 'HAND', seat: 0 }, 0)
		s = { ...s, activeSeat: 1 }
		s = pushAndRun(
			s,
			{ k: 'PROMOTE', from: 'HAND', filter: { suits: ['PERSON'] } },
			ID('p'),
			0,
		)
		while (s.pendingChoice?.k === 'CHOOSE_CARDS')
			s = run(
				applyChoice(s, {
					t: 'RESOLVE_CHOICE',
					choiceId: s.pendingChoice.id,
					selection: [ID('p')] as never,
				}),
			)
		expect(s.pendingChoice).toBeNull()
		expect(s.cards[ID('sup')]!.zone).toEqual({ k: 'HAND', seat: 0 })
	})
})

describe('TAKE_REWARD', () => {
	it('takes one of the looked-at cards and destroys the other', () => {
		let s = fresh()
		for (const n of ['r1', 'r2', 'r3'])
			s = place(s, 'scReward', ID(n), { k: 'REWARD_PILE' })
		s = pushAndRun(s, { k: 'TAKE_REWARD', look: 2 }, ID('r1'), 0)
		const c = s.pendingChoice
		expect(c?.k).toBe('CHOOSE_CARDS')
		if (c?.k !== 'CHOOSE_CARDS') return
		expect(c.candidates).toHaveLength(2)
		s = run(
			applyChoice(s, {
				t: 'RESOLVE_CHOICE',
				choiceId: c.id,
				selection: [c.candidates[0]] as never,
			}),
		)
		expect(s.zones[zoneKey({ k: 'HAND', seat: 0 })]).toEqual([c.candidates[0]])
		expect(s.cards[c.candidates[0]!]!.owner).toBe(0)
		expect(s.cards[c.candidates[1]!]!.zone).toEqual({ k: 'BOX' })
		expect(s.zones[zoneKey({ k: 'REWARD_PILE' })]).toHaveLength(1)
	})
})

describe('Reward cards score negative unless logged', () => {
	it('3PER01 scores −2 in hand and 0 in the Log', () => {
		let s = place(fresh(), '3PER01-13', ID('spk'), { k: 'HAND', seat: 0 }, 0)
		expect(score(s, 0).printedVp.find((e) => e.card === 'spk')?.vp).toBe(-2)
		s = place(fresh(), '3PER01-13', ID('spk'), { k: 'LOG', seat: 0 }, 0)
		expect(score(s, 0).printedVp.find((e) => e.card === 'spk')).toBeUndefined()
	})
})

/** The Second Contact crews implemented so far. */
const SC_CREWS: DeckId[] = ['PIK', 'FRE', 'RIK']

describe('Second Contact fuzz', () => {
	// each Second Contact crew against crews of both base boxes, both seats,
	// with the expansion added to that box
	const cases: [DeckId, DeckId, GameBox][] = []
	for (const t of SC_CREWS) {
		for (const o of ['PIC', 'SHR', 'KOL'] as DeckId[]) cases.push([t, o, 'ORIGINAL'])
		for (const o of ['GEO', 'SOV', 'KHA'] as DeckId[]) cases.push([t, o, 'TBG'])
		for (const o of SC_CREWS) if (o !== t) cases.push([t, o, 'TBG'])
	}
	it.each(cases)(
		'%s against %s on %s + Second Contact reaches GAME_OVER with invariants',
		(t, o, box) => {
			for (const [a, b] of [
				[t, o],
				[o, t],
			] as [DeckId, DeckId][]) {
				for (const seed of [0, 1]) {
					let before: GameState | undefined
					const r = autoPlay(
						setup(
							{
								mode: 'TWO_PLAYER',
								players: [
									{ deck: a, boardSide: 'ADVANCED' },
									{ deck: b, boardSide: 'ADVANCED' },
								],
								seed,
								box,
								expansions: ['SECOND_CONTACT'],
							},
							catalog,
						),
						undefined,
						undefined,
						(s: GameState) => {
							const pre = before
							before = s
							assertInvariants(s, { since: pre })
						},
					)
					expect(r.stopped, `${a}/${b} seed ${seed}`).toBe('GAME_OVER')
				}
			}
		},
		240_000,
	)
})
