// Shorthand compiler (docs/shorthand.md). Three layers:
//   - grammar: the rules the glyph line promises, one small tree each;
//   - golden: every operation, Development cost and mission of the real
//     catalogue compiles, and the whole catalogue is pinned in one snapshot
//     (review the diff when a card tree or the compiler changes);
//   - budget: the catalogue stays glanceable — the numbers the mobile design
//     (docs/ui-mobile.md) was sized against.

import { beforeAll, describe, expect, it } from 'vitest'

import type { Effect, Operation } from './resolver/nodes'
import type { CardCatalog } from './setup'
import { loadCatalog } from '../data/catalog'
import {
	formatShorthand,
	shorthand,
	shorthandCondition,
	shorthandDevelopmentCost,
	shorthandOperation,
	shorthandWeight,
	type ShorthandLine,
	type Tok,
} from './shorthand'

const op = (effect: Effect, extra: Partial<Operation> = {}): Operation => ({
	type: 'PLAY',
	costsAction: false,
	isAttack: false,
	effect,
	...extra,
})
const line = (effect: Effect, extra: Partial<Operation> = {}) =>
	formatShorthand(shorthandOperation(op(effect, extra)))

describe('shorthand grammar', () => {
	it('puts a cost left of the chevron and the payoff right of it', () => {
		expect(
			line(
				{
					k: 'PAY_THEN',
					cost: { k: 'COST_RESOURCE', res: 'DIL', amount: 1 },
					body: {
						k: 'WARP',
						ship: { zones: ['IN_PLAY'], thisCard: true },
						to: { zones: ['LOCATIONS'] },
					},
				},
				{ type: 'ACTIVATION' },
			),
		).toBe('ACTI | {−1 DIL} › WARP')
	})

	it('writes hand, pool and Incidents as signed arithmetic', () => {
		expect(
			line({
				k: 'SEQ',
				steps: [
					{ k: 'DRAW', count: 2 },
					{ k: 'DISCARD', from: 'HAND', count: 1 },
					{ k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
					{ k: 'TAKE', deck: 'INCIDENT', count: 1 },
					{ k: 'RETURN_INCIDENT', target: 'THIS' },
				],
			}),
		).toBe('PLAY | +2 CARD −1 CARD +1 GLO +1<INCIDENT> −1<INCIDENT>')
	})

	it('marks the action cost, ATTACK and a specialty requirement in the head', () => {
		expect(
			line(
				{ k: 'GAIN_CARD', suits: ['ALLY'] },
				{
					costsAction: true,
					isAttack: true,
					requires: { specialty: 'INFLUENCE', min: 4 },
				},
			),
		).toBe('PLAY ACT ATTACK REQ[INFLUENCE ≥4] | +ALLY')
	})

	it('wraps optional effects and the opponent in their own groups', () => {
		expect(
			line({
				k: 'SEQ',
				steps: [
					{ k: 'MAY', body: { k: 'DRAW', count: 1 } },
					{ k: 'FORCE', body: { k: 'DISCARD', from: 'HAND', count: 1 } },
				],
			}),
		).toBe('PLAY | (+1 CARD)? OPP[−1 CARD]')
	})

	it('drops choice options that read the same and unwraps a lone survivor', () => {
		const freePlay = (from: 'HAND' | 'DISCARD'): Effect => ({
			k: 'FREE_PLAY',
			filter: { suits: ['DIRECTIVE'] },
			from: { k: from, seat: 0 },
		})
		expect(
			line({
				k: 'CHOOSE_ONE',
				options: [
					{ label: 'from hand', body: freePlay('HAND') },
					{ label: 'from discard', body: freePlay('DISCARD') },
				],
			}),
		).toBe('PLAY | FREE_PLAY ·<DIRECTIVE>')
	})

	it('renders "for each" as per, with a cap', () => {
		expect(
			line(
				{
					k: 'DRAW',
					count: {
						k: 'MIN',
						terms: [
							{
								k: 'COUNT',
								query: { zones: ['IN_PLAY'], filter: { traits: ['SECURITY'] } },
							},
							3,
						],
					},
				},
				{ type: 'RESUPPLY' },
			),
		).toBe('RESU | +1 CARD / #SECURITY max3')
	})

	it('reads a filter naming (nearly) every suit as any card', () => {
		expect(
			shorthand({
				k: 'FIND',
				filter: {
					suits: [
						'PERSON',
						'CARGO',
						'SHIP',
						'ALLY',
						'ENCOUNTER',
						'INCIDENT',
						'LOCATION',
					],
				},
				zones: ['ALL_OWNED'],
			}),
		).toEqual([
			{ k: 'glyph', g: 'FIND' },
			{ k: 'qual', body: [{ k: 'glyph', g: 'CARD' }] },
		])
	})

	it('compresses a run of look-alike steps into one "each" group', () => {
		const maySuit = (s: 'PERSON' | 'CARGO' | 'SHIP'): Effect => ({
			k: 'MAY',
			body: {
				k: 'PAY_THEN',
				cost: { k: 'COST_DISCARD', count: 1, filter: { suits: [s] } },
				body: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
			},
		})
		const toks = shorthand({
			k: 'SEQ',
			steps: [maySuit('PERSON'), maySuit('CARGO'), maySuit('SHIP')],
		})
		expect(toks).toHaveLength(1)
		expect(
			formatShorthand({
				timing: 'PLAY',
				action: false,
				attack: false,
				trigger: [],
				body: toks,
			}),
		).toBe('PLAY | each(({−1 CARD ·<PERSON>/<CARGO>/<SHIP>} › +1 GLO)?)')
	})

	it('keeps "if you did" apart from a real condition', () => {
		expect(
			line({
				k: 'SEQ',
				steps: [
					{ k: 'MAY', body: { k: 'DRAW', count: 1, bind: '$x' } },
					{
						k: 'IF',
						cond: { k: 'DID', bind: '$x' },
						then: { k: 'GAIN_RESOURCE', res: 'GLO', amount: 1 },
					},
					{
						k: 'IF',
						cond: { k: 'HAS_TRAIT_IN_PLAY', trait: 'ENGINEER' },
						then: { k: 'GAIN_ACTION', amount: 1 },
					},
				],
			}),
		).toBe('PLAY | (+1 CARD)? ✓⇒ +1 GLO IF ≥1 #ENGINEER ⇒ +1 ACT')
	})

	it("prefixes a reaction with its trigger, the opponent's in their group", () => {
		expect(
			line(
				{ k: 'IGNORE_ATTACK' },
				{ type: 'REACTION', trigger: { on: 'WOULD_BE_ATTACKED' } },
			),
		).toBe('REAC | OPP[ATTACK] : SHIELD')
	})

	it('keeps a passive rule change as words', () => {
		const toks = shorthand({ k: 'MODIFIER_ATTACH', id: '1BUR02' })
		expect(toks).toHaveLength(1)
		expect(toks[0]?.k).toBe('rule')
	})
})

// ---------------------------------------------------------------------------
// Golden: the real catalogue
// ---------------------------------------------------------------------------

let catalog: CardCatalog
beforeAll(async () => {
	catalog = await loadCatalog()
})

const EMPTY_OK = new Set([
	'NOOP',
	'SELECT',
	'DRONE',
	'ASSIMILATE',
	'MODIFIER_DETACH',
])

/** Every node kind in a tree, to tell a genuinely empty effect from a lost one. */
function kinds(e: unknown, out = new Set<string>()): Set<string> {
	if (Array.isArray(e)) for (const x of e) kinds(x, out)
	else if (e !== null && typeof e === 'object') {
		const k = (e as { k?: unknown }).k
		if (typeof k === 'string') out.add(k)
		for (const v of Object.values(e)) kinds(v, out)
	}
	return out
}

function catalogueLines(): { id: string; lines: ShorthandLine[] }[] {
	return catalog.defs.map((def) => ({
		id: def.id,
		lines: [
			...def.operations.map(shorthandOperation),
			...(def.developmentCost !== null
				? [shorthandDevelopmentCost(def.developmentCost)]
				: []),
		],
	}))
}

describe('shorthand golden', () => {
	it('compiles every operation to a non-empty line unless the tree does nothing', () => {
		let ops = 0
		for (const def of catalog.defs) {
			for (const [i, o] of def.operations.entries()) {
				ops++
				const l = shorthandOperation(o)
				const doesNothing = [...kinds(o.effect)].every((k) => EMPTY_OK.has(k))
				if (!doesNothing)
					expect(
						l.body.length,
						`${def.id} op ${i} (${o.type}) compiled to nothing`,
					).toBeGreaterThan(0)
			}
		}
		expect(ops).toBeGreaterThan(550)
	})

	it('compiles every crew-board mission goal and reward', () => {
		for (const [deck, board] of Object.entries(catalog.boards)) {
			for (const m of [...(board?.basic ?? []), ...(board?.advanced ?? [])]) {
				expect(
					shorthandCondition(m.goal).length,
					`${deck} mission ${m.index} goal`,
				).toBeGreaterThan(0)
				expect(
					shorthand(m.reward).length,
					`${deck} mission ${m.index} reward`,
				).toBeGreaterThan(0)
			}
		}
	})

	it('pins the whole catalogue (review this snapshot like a diff of every card)', () => {
		const pinned: Record<string, string[]> = {}
		for (const { id, lines } of catalogueLines())
			pinned[id] = lines.map(formatShorthand)
		expect(pinned).toMatchSnapshot()
	})
})

describe('shorthand readability budget', () => {
	it('keeps 90% of lines at 8 glyphs or fewer and the median near 3', () => {
		const weights = catalogueLines()
			.flatMap((c) => c.lines)
			.filter((l) => l.timing !== 'DEVELOPMENT')
			.map(shorthandWeight)
			.sort((a, b) => a - b)
		const at = (p: number) => weights[Math.floor((weights.length - 1) * p)] ?? 0
		const underEight = weights.filter((w) => w <= 8).length / weights.length
		expect(underEight).toBeGreaterThanOrEqual(0.9)
		expect(at(0.5)).toBeLessThanOrEqual(4)
	})

	it('uses rule sentences only where a card changes a rule, and rarely', () => {
		const hasRule = (toks: Tok[]): boolean =>
			toks.some(
				(t) =>
					t.k === 'rule' ||
					Object.values(t).some(
						(v) => Array.isArray(v) && hasRule(v.flat() as Tok[]),
					),
			)
		let withRules = 0
		for (const def of catalog.defs)
			for (const o of def.operations) {
				if (!hasRule(shorthandOperation(o).body)) continue
				withRules++
				const k = kinds(o.effect)
				expect(
					k.has('MODIFIER_ATTACH') || k.has('ALT_PLAY'),
					`${def.id} ${o.type}`,
				).toBe(true)
			}
		// 30 for box 1 (+ MAL); To Boldly Go adds Duty Officer slots and hand sizes
		expect(withRules).toBeLessThanOrEqual(40)
	})
})
