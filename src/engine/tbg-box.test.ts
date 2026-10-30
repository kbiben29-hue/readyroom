// To Boldly Go as a game box (src/data/boxes.ts): setup takes only box-2
// common cards, the original box takes only box-1 ones, and full games
// between the two To Boldly Go crews (2GEO, 2SOV) reach GAME_OVER with the
// engine invariants intact.

import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog } from '../data/catalog'
import { setup, type CardCatalog, type SetupConfig } from './setup'
import { autoPlay } from '../bot/autoPlay'
import { assertInvariants } from './invariants'
import { cardDef } from './cards'
import type { GameState } from './state'
import type { DeckId } from '../data/ids'
import type { GameBox } from '../data/boxes'

let catalog: CardCatalog
beforeAll(async () => {
	catalog = await loadCatalog()
})

function config(
	a: DeckId,
	b: DeckId,
	seed: number,
	box: GameBox | undefined,
): SetupConfig {
	return {
		mode: 'TWO_PLAYER',
		players: [
			{ deck: a, boardSide: 'ADVANCED' },
			{ deck: b, boardSide: 'ADVANCED' },
		],
		seed,
		box,
	}
}

/** Printed numbers of every unowned common card on the table. */
function commonNumbers(s: GameState): string[] {
	return Object.values(s.cards)
		.map((c) => cardDef(c.def))
		.filter((d) => d.deck === 'COMMON' && d.cardId !== null)
		.map((d) => d.cardId!)
}

describe('game box setup', () => {
	it('To Boldly Go uses only its own common cards', () => {
		const s = setup(config('GEO', 'SOV', 4, 'TBG'), catalog)
		const nums = commonNumbers(s)
		expect(nums.length).toBe(107)
		expect(nums.every((n) => n.startsWith('2'))).toBe(true)
	})

	it('the original game (and a config without a box) uses only box-1 commons', () => {
		for (const box of ['ORIGINAL', undefined] as const) {
			const s = setup(config('PIC', 'SHR', 4, box), catalog)
			const nums = commonNumbers(s)
			expect(nums.length).toBeGreaterThan(0)
			expect(nums.every((n) => n.startsWith('1'))).toBe(true)
		}
	})

	it('2SOV starts with its Status card and a controlled LOCATION', () => {
		const s = setup(config('SOV', 'GEO', 2, 'TBG'), catalog)
		const zone = (k: string) =>
			Object.values(s.cards).filter(
				(c) => c.owner === 0 && c.zone.k === k,
			).length
		expect(zone('CAPTAIN')).toBe(1)
		expect(zone('STATUS')).toBe(1)
		expect(zone('LOCATION_AREA')).toBe(1)
		expect(s.players[0].missions).toHaveLength(3)
	})
})

describe('To Boldly Go fuzz', () => {
	it.each([
		['GEO', 'SOV'],
		['SOV', 'GEO'],
	] as [DeckId, DeckId][])(
		'%s/%s in the To Boldly Go box reaches GAME_OVER with invariants after every intent',
		(a, b) => {
			for (const seed of [0, 1, 2]) {
				let before: GameState | undefined
				const r = autoPlay(
					setup(config(a, b, seed, 'TBG'), catalog),
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
		240_000,
	)

	it.each(['PIC', 'SHR', 'KOL', 'SIS', 'SEL'] as DeckId[])(
		'2SOV against %s on the original box reaches GAME_OVER',
		(o) => {
			for (const [a, b] of [
				['SOV', o],
				[o, 'SOV'],
			] as [DeckId, DeckId][]) {
				const r = autoPlay(setup(config(a, b, 0, undefined), catalog))
				expect(r.stopped, `${a}/${b}`).toBe('GAME_OVER')
			}
		},
		240_000,
	)
})
