// forkState (src/engine/state.ts): the probe and the bots run the engine on
// a fork that deep-copies only the stack and shares everything else with the
// original. That is only safe because the engine never writes in place
// outside the stack's ctx.bindings. Pin it: run legalIntents (the probe),
// firstLegalSelection and reduce on deep-FROZEN states along real games. A
// stray in-place write would throw in strict mode, which would either surface
// here or flip a probe answer, so the frozen and unfrozen results must match.

import { beforeAll, describe, expect, it } from 'vitest'

import { loadCatalog } from '../data/catalog'
import type { CardCatalog } from './setup'
import { setup } from './setup'
import { forkState, type GameState } from './state'
import { firstLegalSelection, legalIntents, reduce } from './intents'
import { autoPlay } from '../bot/autoPlay'

let catalog: CardCatalog

beforeAll(async () => {
	catalog = await loadCatalog()
})

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value)
		for (const v of Object.values(value)) deepFreeze(v)
	}
	return value
}

describe('forkState', () => {
	it('copies the stack, shares the rest', () => {
		const s = setup(
			{
				mode: 'TWO_PLAYER',
				players: [
					{ deck: 'PIC', boardSide: 'ADVANCED' },
					{ deck: 'SHR', boardSide: 'ADVANCED' },
				],
				seed: 1,
			},
			catalog,
		)
		const f = forkState(s)
		expect(f).toEqual(s)
		expect(f.cards).toBe(s.cards)
		expect(f.stack).not.toBe(s.stack)
	})

	it('the probe, firstLegalSelection and reduce never write outside the forked stack', () => {
		for (const [a, b, seed] of [
			['KOL', 'SIS', 7],
			['SEL', 'PIC', 8],
		] as const) {
			const states: {
				state: GameState
				next: ReturnType<typeof legalIntents>[number]
			}[] = []
			let prev: GameState | undefined
			autoPlay(
				setup(
					{
						mode: 'TWO_PLAYER',
						players: [
							{ deck: a, boardSide: 'ADVANCED' },
							{ deck: b, boardSide: 'ADVANCED' },
						],
						seed,
					},
					catalog,
				),
				undefined,
				400,
				(s, intent, step) => {
					if (prev !== undefined && step % 3 === 0)
						states.push({ state: prev, next: intent })
					prev = s
				},
			)
			expect(states.length).toBeGreaterThan(50)
			for (const { state, next } of states) {
				const plain = structuredClone(state)
				const frozen = deepFreeze(structuredClone(state))
				expect(legalIntents(frozen)).toEqual(legalIntents(plain))
				expect(firstLegalSelection(frozen)).toEqual(firstLegalSelection(plain))
				// branching twice off one state gives the same result, and the
				// frozen original survives both runs
				const r1 = reduce(forkState(frozen), next).state
				const r2 = reduce(forkState(frozen), next).state
				expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
				expect(JSON.stringify(r1)).toBe(
					JSON.stringify(reduce(structuredClone(state), next).state),
				)
			}
		}
	}, 60_000)
})
