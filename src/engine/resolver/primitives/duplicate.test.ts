// §7 DUPLICATE (rules/08 → duplicate, rules/12 §12.13, todo/04 §7):
//   five behaviours, against card texts functionally transcribed from the
//   rulebook examples (authoritative DSL lands with todo/12/13):
//   1. 1CAR10 × 1ALL04 — "Log this card" redirects to the DUPLICATOR
//      (self-reference redirection);
//   2. 1SIS14 × 1CAR03 — the DEPLOY (impossible for a PERSON) is skipped,
//      the rest resolves (refresh SHIP, draw 2, junk 1);
//   3. 1PER10 × 1CAR10 — only the recall runs: the nested DUPLICATE is a
//      no-op and the duplicate's own activation cost is not re-charged;
//   4. the target operation's action cost is NOT paid (no extra action);
//   5. the target operation's Specialty restriction still applies (skip when
//      unmet) and a nested DUPLICATE no-ops.
// DUPLICATE also exercises the CHOOSE_CARDS (source) and CHOOSE_OPTION
// (operation) choice seam with mid-duplicate resume.

import { describe, expect, it } from 'vitest'
import {
	fresh,
	register,
	makeDef,
	place,
	play,
	op,
	ID,
	setActions,
	setSpecialty,
	setResources,
} from '../testUtils'
import { run } from '../stack'
import { applyChoice } from '../choices'
import type { GameState } from '../../state'

function seq(...steps: import('../nodes').Effect[]): import('../nodes').Effect {
	return { k: 'SEQ', steps }
}
const gainRes = (
	res: 'DIL' | 'LAT' | 'GLO',
	amount: number,
): import('../nodes').Effect => ({ k: 'GAIN_RESOURCE', res, amount })

function autoplay(state: GameState, card: string): GameState {
	let s = play(state, ID(card))
	while (s.pendingChoice !== null) {
		const c = s.pendingChoice
		let sel: unknown
		if (c.k === 'CHOOSE_CARDS') sel = [c.candidates[0]!]
		else if (c.k === 'CHOOSE_OPTION') sel = { key: c.options[0]!.key }
		else if (c.k === 'CHOOSE_DESTINATION') sel = c.options[0]!
		else throw new Error(`unexpected choice ${c.k}`)
		s = run(
			applyChoice(s, { t: 'RESOLVE_CHOICE', choiceId: c.id, selection: sel }),
		)
	}
	return s
}

describe('§7.1 1CAR10 × 1ALL04: self-reference redirects to the duplicator', () => {
	it('LOG "THIS" inside a duplicated op logs the duplicator (1CAR10), not the source', () => {
		register([
			makeDef({
				id: '1ALL04',
				suit: 'ALLY',
				operations: [
					op(
						'PLAY',
						seq(
							{ k: 'GAIN_CARD', suits: ['PERSON'] },
							{ k: 'LOG', target: 'THIS' },
						),
					),
					op('PLAY', seq({ k: 'LOG', target: 'THIS' })),
				],
			}),
			makeDef({
				id: 'paradise',
				suit: 'ALLY',
				operations: [op('PLAY', gainRes('DIL', 1))],
			}),
			makeDef({ id: 'crew', suit: 'PERSON', operations: [] }),
			makeDef({
				id: 'orb',
				suit: 'CARGO',
				operations: [
					op('PLAY', {
						k: 'DUPLICATE',
						suits: ['ALLY'],
						from: ['LOG'],
						opType: 'PLAY',
					}),
				],
			}),
		])
		let s = fresh()
		s = place(s, 'crew', ID('crew'), { k: 'MARKET_OFFER', suit: 'PERSON' })
		s = place(s, '1ALL04', ID('deno'), { k: 'LOG', seat: 0 }, 0)
		s = place(s, 'paradise', ID('par'), { k: 'LOG', seat: 0 }, 0)
		s = place(s, 'orb', ID('orb'), { k: 'HAND', seat: 0 }, 0)

		// first a CHOOSE_CARDS over the two ALLY sources, then a CHOOSE_OPTION
		// over 1ALL04' two operations — both auto-answered via autoplay.
		const out = autoplay(s, 'orb')
		expect(out.pendingChoice).toBeNull()
		expect(out.zones['LOG:0']).toContain(ID('orb')) // ← self-ref redirect logs 1CAR10
		expect(out.zones['LOG:0']).toContain(ID('deno')) // the source is NOT logged
		// the duplicated GAIN_CARD(PERSON) resolved:
		expect(out.cards[ID('crew')]!.owner).toBe(0)
	})
})

describe('§7.2 1SIS14 × 1CAR03: impossible sub-effects are skipped, the rest resolves', () => {
	it('the DEPLOY (a PERSON cannot deploy) is skipped; refresh/draw/junk all happen', () => {
		register([
			makeDef({
				id: 'cloa',
				suit: 'CARGO',
				operations: [
					op(
						'PLAY',
						seq(
							{
								k: 'DEPLOY',
								target: {
									zones: ['ALL_OWNED'],
									seat: 'SELF',
									filter: { ids: ['dupPerson'] },
								},
							},
							{
								k: 'REFRESH',
								target: {
									zones: [{ k: 'FLEET', seat: 0 }],
									filter: { suits: ['SHIP'] },
								},
								count: 3,
							},
							{ k: 'DRAW', count: 2 },
							{
								k: 'JUNK',
								target: { zones: [{ k: 'MARKET_OFFER', suit: 'CARGO' }] },
							},
						),
					),
				],
			}),
			makeDef({
				id: 'dupPerson',
				suit: 'PERSON',
				operations: [
					op('PLAY', {
						k: 'DUPLICATE',
						suits: ['PERSON', 'CARGO'],
						from: ['DISCARD'],
						opType: 'PLAY',
					}),
				],
			}),
			makeDef({ id: 'warship', suit: 'SHIP', operations: [] }),
			makeDef({ id: 'drawcard', suit: 'CARGO', operations: [] }),
			makeDef({ id: 'junkme', suit: 'CARGO', operations: [] }),
		])
		let s = fresh()
		s = place(s, 'cloa', ID('cloa'), { k: 'DISCARD', seat: 0 }, 0) // source for 1SIS14's duplicate
		s = place(s, 'dupPerson', ID('dupPerson'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'warship', ID('w0'), { k: 'FLEET', seat: 0 }, 0, {
			exhausted: true,
		})
		s = place(s, 'drawcard', ID('d1'), { k: 'DRAW', seat: 0 }, 0)
		s = place(s, 'drawcard', ID('d2'), { k: 'DRAW', seat: 0 }, 0)
		s = place(s, 'junkme', ID('jm'), { k: 'MARKET_OFFER', suit: 'CARGO' })

		const out = autoplay(s, 'dupPerson')
		expect(out.pendingChoice).toBeNull()
		// DEPLOY skipped (1SIS14 is PERSON): SKIPPED log, and the deploy target never moved
		const deploySkip = out.log.find(
			(l) => l.kind === 'SKIPPED' && l.message.includes('DEPLOY'),
		)
		expect(deploySkip).toBeTruthy()
		// refresh happened (the exhausted ship is upright)
		expect(out.cards[ID('w0')]!.exhausted).toBe(false)
		// draw 2
		expect(out.zones['DRAW:0']).toHaveLength(0)
		expect(out.zones['HAND:0']).toContain(ID('d2'))
		// junk 1
		expect(out.zones['JUNK']).toContain(ID('jm'))
	})
})

describe('§7.3 1PER10 × 1CAR10: only the recall runs', () => {
	it("the nested DUPLICATE is a no-op and Orb's activation cost is not re-charged", () => {
		register([
			makeDef({
				id: 'orb',
				suit: 'CARGO',
				traits: ['TIME_TRAVEL'],
				operations: [
					op(
						'PLAY',
						seq(
							{
								k: 'DUPLICATE',
								suits: ['PERSON', 'CARGO', 'ALLY'],
								from: ['LOG'],
								opType: 'PLAY',
							},
							{
								k: 'RECALL',
								target: {
									zones: [{ k: 'STAGING', seat: 0 }],
									filter: { traits: ['TIME_TRAVEL'] },
								},
							},
						),
					),
				],
			}),
			makeDef({
				id: '1PER10',
				suit: 'PERSON',
				operations: [
					op(
						'PLAY',
						seq(
							{
								k: 'PUT_INTO_STAGING',
								target: {
									zones: [{ k: 'HAND', seat: 0 }],
									filter: { suits: ['PERSON'] },
								},
							},
							{
								k: 'DUPLICATE',
								suits: ['PERSON', 'CARGO'],
								from: ['DISCARD'],
								opType: 'PLAY',
							},
						),
					),
				],
			}),
			makeDef({ id: 'stager', suit: 'PERSON', operations: [] }),
			makeDef({
				id: 'tt',
				suit: 'CARGO',
				traits: ['TIME_TRAVEL'],
				operations: [],
			}),
			makeDef({ id: 'incident', suit: 'INCIDENT', operations: [] }),
		])
		let s = fresh()
		s = place(s, 'orb', ID('orb'), { k: 'DISCARD', seat: 0 }, 0) // 1PER10's duplicate source
		s = place(s, '1PER10', ID('1PER10'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'stager', ID('stager'), { k: 'HAND', seat: 0 }, 0)
		s = place(s, 'tt', ID('tt'), { k: 'STAGING', seat: 0 }, 0)
		s = place(s, 'incident', ID('inc'), { k: 'INCIDENT_DECK' })

		const out = autoplay(s, '1PER10')
		expect(out.pendingChoice).toBeNull()
		// only the recall ran: the TIME TRAVEL card left Staging for the hand
		expect(out.zones['HAND:0']).toContain(ID('tt'))
		expect(out.zones['STAGING:0']).not.toContain(ID('tt'))
		// the nested DUPLICATE no-opped (and logged it)
		const nested = out.log.find(
			(l) => l.kind === 'SKIPPED' && l.message.includes('nested'),
		)
		expect(nested).toBeTruthy()
		// nothing touched the Incident deck (activation cost not re-charged)
		expect(out.zones['INCIDENT_DECK']).toContain(ID('inc'))
		// the source 1CAR10 was NOT consumed
		expect(out.zones['DISCARD:0']).toContain(ID('orb'))
	})
})

describe("§7.4 the target operation's action cost is never paid", () => {
	it('duplicating a costsAction PLAY op spends no extra action', () => {
		register([
			makeDef({
				id: 'activateMe',
				suit: 'CARGO',
				operations: [op('PLAY', gainRes('DIL', 1), { costsAction: true })],
			}),
			makeDef({
				id: 'duplic8r',
				suit: 'PERSON',
				operations: [
					op(
						'PLAY',
						{ k: 'DUPLICATE', suits: ['CARGO'], from: ['LOG'], opType: 'PLAY' },
						{ costsAction: true },
					),
				],
			}),
		])
		let s = setActions(fresh(), 0, 1) // exactly ONE action — only the duplicator's own
		s = place(s, 'activateMe', ID('am'), { k: 'LOG', seat: 0 }, 0)
		s = place(s, 'duplic8r', ID('d8'), { k: 'HAND', seat: 0 }, 0)
		const out = autoplay(s, 'd8')
		// if the duplicated op also charged an action, spendAction would throw
		expect(out.players[0]!.actions.available).toBe(0) // exactly one action spent (the duplicator's)
		expect(out.players[0]!.resources.DIL).toBe(1) // the duplicated benefit resolved
	})
})

describe('§7.5 specialty gates + nested duplicate', () => {
	it("the target operation's Specialty restriction still applies (skip when unmet)", () => {
		register([
			makeDef({
				id: 'milOp',
				suit: 'CARGO',
				operations: [
					op('PLAY', gainRes('LAT', 2), {
						requires: { specialty: 'MILITARY', min: 4 },
					}),
				],
			}),
			makeDef({
				id: 'dup5',
				suit: 'PERSON',
				operations: [
					op('PLAY', {
						k: 'DUPLICATE',
						suits: ['CARGO'],
						from: ['LOG'],
						opType: 'PLAY',
					}),
				],
			}),
		])
		let s = setSpecialty(fresh(), 0, 'MILITARY', 2) // gate unmet
		s = place(s, 'milOp', ID('m'), { k: 'LOG', seat: 0 }, 0)
		s = place(s, 'dup5', ID('d5'), { k: 'HAND', seat: 0 }, 0)
		const out = autoplay(s, 'd5')
		expect(out.players[0]!.resources.LAT).toBe(0) // NOT gained
		expect(
			out.log.filter((l) => l.kind === 'SKIPPED').length,
		).toBeGreaterThanOrEqual(1)
	})

	it('a nested DUPLICATE inside a duplicated operation is a no-op (no chains)', () => {
		register([
			makeDef({
				id: 'hasNested',
				suit: 'CARGO',
				operations: [
					op(
						'PLAY',
						seq(
							{
								k: 'DUPLICATE',
								suits: ['CARGO'],
								from: ['LOG'],
								opType: 'PLAY',
							},
							gainRes('GLO', 3),
						),
					),
				],
			}),
			makeDef({
				id: 'dup6',
				suit: 'PERSON',
				operations: [
					op('PLAY', {
						k: 'DUPLICATE',
						suits: ['CARGO'],
						from: ['LOG'],
						opType: 'PLAY',
					}),
				],
			}),
		])
		let s = setResources(fresh(), 0, 'GLO', 0)
		s = place(s, 'hasNested', ID('hn'), { k: 'LOG', seat: 0 }, 0)
		s = place(s, 'dup6', ID('d6'), { k: 'HAND', seat: 0 }, 0)
		const out = autoplay(s, 'd6')
		expect(out.pendingChoice).toBeNull()
		expect(out.players[0]!.resources.GLO).toBe(3) // the non-duplicate step resolved
		expect(
			out.log.filter(
				(l) => l.kind === 'SKIPPED' && l.message.includes('nested'),
			).length,
		).toBeGreaterThanOrEqual(1)
	})
})
