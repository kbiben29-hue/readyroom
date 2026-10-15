// Live values on Shorthand lines (src/engine/shorthandLive.ts): counted
// amounts and conditions evaluated on a real board with the engine's own
// evaluators; anything bound to the resolving operation stays unevaluated.

import { beforeAll, describe, expect, it } from 'vitest'

import type { Effect, Operation } from './resolver/nodes'
import type { GameState } from './state'
import type { CardInstanceId } from './ids'
import { setup } from './setup'
import { cardDef } from './cards'
import { makeCatalog, sessionConfig } from '../session/playGame'
import { shorthandOperation, type Tok } from './shorthand'
import { isContextFree, withLiveValues } from './shorthandLive'

let state: GameState
let pic: CardInstanceId

beforeAll(async () => {
	state = setup(sessionConfig(), await makeCatalog())
	const iid = Object.values(state.cards).find(
		(c) => c.def === '1PIC01-24' && c.owner === 0,
	)?.iid
	if (iid === undefined) throw new Error('PIC captain not found')
	pic = iid
})

const op = (effect: Effect): Operation => ({
	type: 'PLAY',
	costsAction: false,
	isAttack: false,
	effect,
})

function first<K extends Tok['k']>(toks: Tok[], k: K): Extract<Tok, { k: K }> {
	const t = toks.find((x) => x.k === k)
	if (t === undefined) throw new Error(`no ${k} token`)
	return t as Extract<Tok, { k: K }>
}

describe('withLiveValues', () => {
	it('counts a per amount on the current board (PIC: 1 VP per ALLY owned)', () => {
		const endgame = cardDef('1PIC01-24').operations.find(
			(o) => o.type === 'ENDGAME',
		)
		if (endgame === undefined) throw new Error('no ENDGAME op')
		const line = withLiveValues(shorthandOperation(endgame), state, 0, pic)
		const owned = Object.values(state.cards).filter(
			(c) => c.owner === 0 && cardDef(c.def).suit === 'ALLY',
		).length
		expect(first(line.body, 'per').live).toBe(owned)
	})

	it('marks whether a condition holds', () => {
		const cond = (value: number): Effect => ({
			k: 'IF',
			cond: { k: 'SPECIALTY_AT_LEAST', specialty: 'RESEARCH', value },
			then: { k: 'DRAW', count: 1 },
		})
		const at = (value: number) =>
			first(
				withLiveValues(shorthandOperation(op(cond(value))), state, 0, pic).body,
				'if',
			).holds
		expect(at(0)).toBe(true)
		expect(at(99)).toBe(false)
	})

	it('leaves amounts and conditions bound to the resolving operation alone', () => {
		const bound: Effect = {
			k: 'SEQ',
			steps: [
				{ k: 'DRAW', count: 1, bind: '$d' },
				{
					k: 'IF',
					cond: { k: 'BOUND_IS', bind: '$d', filter: { suits: ['PERSON'] } },
					then: {
						k: 'GAIN_RESOURCE',
						res: 'GLO',
						amount: { k: 'TRAIT_COUNT', bind: '$d' },
					},
				},
			],
		}
		const line = withLiveValues(shorthandOperation(op(bound)), state, 0, pic)
		const iff = first(line.body, 'if')
		expect(iff.holds).toBeUndefined()
		expect(first(iff.then, 'per').live).toBeUndefined()
	})

	it('tells context-free amounts from bound ones', () => {
		expect(isContextFree({ k: 'SPECIALTY', specialty: 'MILITARY' })).toBe(true)
		expect(isContextFree({ k: 'SKILL_ICONS', specialty: 'CHOSEN' })).toBe(false)
		expect(
			isContextFree({
				k: 'COUNT',
				query: { zones: ['IN_PLAY'], bound: '$x' },
			}),
		).toBe(false)
	})
})
