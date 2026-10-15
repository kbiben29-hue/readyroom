// §8 FORCE / actor switching (rules/12 §12.14, todo/04 §8):
//   - OPPONENT/FORCE flip ctx.actor, so every PendingChoice carries the
//     deciding player's seat;
//   - "Dismiss an opponent SHIP" → the choice's seat is the active player;
//   - "Force your opponent to dismiss a SHIP" → the choice's seat is the
//     opponent;
//   - a forced effect that is entirely unresolvable is ignored, not an error.

import { describe, expect, it } from 'vitest'
import {
	fresh,
	register,
	makeDef,
	place,
	pushAndRun,
	play,
	op,
	ID,
} from '../testUtils'
import type { GameState } from '../../state'

function seedShips(): GameState {
	register([
		makeDef({ id: 'warship', suit: 'SHIP', operations: [] }),
		makeDef({
			id: 'strike',
			suit: 'PERSON',
			operations: [op('PLAY', { k: 'GAIN_RESOURCE', res: 'DIL', amount: 1 })],
		}),
	])
	let s = fresh()
	s = place(s, 'warship', ID('w0'), { k: 'FLEET', seat: 1 }, 1)
	s = place(s, 'warship', ID('w1'), { k: 'FLEET', seat: 1 }, 1)
	s = place(s, 'strike', ID('st'), { k: 'HAND', seat: 0 }, 0)
	return s
}

describe('FORCE: choice ownership', () => {
	it('"dismiss an opponent SHIP" -> the active player decides (seat = you)', () => {
		register([
			makeDef({ id: 'warship', suit: 'SHIP', operations: [] }),
			makeDef({
				id: 'strike',
				suit: 'PERSON',
				operations: [
					op('PLAY', {
						k: 'SEQ',
						steps: [
							{
								k: 'DISMISS',
								target: {
									zones: [{ k: 'FLEET', seat: 1 }],
									filter: { suits: ['SHIP'] },
								},
							},
						],
					}),
				],
			}),
		])
		let s = fresh()
		s = place(s, 'warship', ID('w0'), { k: 'FLEET', seat: 1 }, 1)
		s = place(s, 'warship', ID('w1'), { k: 'FLEET', seat: 1 }, 1)
		s = place(s, 'strike', ID('st'), { k: 'HAND', seat: 0 }, 0)
		const out = play(s, ID('st'))
		expect(out.pendingChoice?.k).toBe('CHOOSE_CARDS')
		if (out.pendingChoice === null || out.pendingChoice.k !== 'CHOOSE_CARDS') {
			throw new Error('expected CHOOSE_CARDS')
		}
		const choice = out.pendingChoice
		expect(choice.seat).toBe(0) // active player picks the target
		expect(choice.candidates.sort()).toEqual([ID('w0'), ID('w1')].sort())
	})

	it('"force your opponent to dismiss a SHIP" -> the OPPONENT decides (seat = them)', () => {
		register([
			makeDef({ id: 'warship', suit: 'SHIP', operations: [] }),
			makeDef({
				id: 'threat',
				suit: 'PERSON',
				operations: [
					op('PLAY', {
						// OPPONENT flips the actor to seat 1; DISMISS then targets "SELF"
						// (their own) SHIP, and the pick belongs to seat 1.
						k: 'OPPONENT',
						body: {
							k: 'SEQ',
							steps: [
								{
									k: 'DISMISS',
									target: {
										zones: [{ k: 'FLEET', seat: 0 }],
										seat: 'SELF',
										filter: { suits: ['SHIP'] },
									},
								},
							],
						},
					}),
				],
			}),
		])
		let s = fresh()
		s = place(s, 'warship', ID('w0'), { k: 'FLEET', seat: 1 }, 1)
		s = place(s, 'warship', ID('w1'), { k: 'FLEET', seat: 1 }, 1)
		s = place(s, 'threat', ID('th'), { k: 'HAND', seat: 0 }, 0)
		const out = play(s, ID('th'))
		expect(out.pendingChoice?.k).toBe('CHOOSE_CARDS')
		if (out.pendingChoice === null || out.pendingChoice.k !== 'CHOOSE_CARDS') {
			throw new Error('expected CHOOSE_CARDS')
		}
		const choice = out.pendingChoice
		expect(choice.seat).toBe(1) // the opponent must pick which ship
		expect(choice.candidates.sort()).toEqual([ID('w0'), ID('w1')].sort())
	})

	it('FORCE is sugar for OPPONENT with the actor flipped', () => {
		const s = seedShips()
		const out = pushAndRun(
			s,
			{
				k: 'FORCE',
				body: {
					k: 'DISMISS',
					target: {
						zones: [{ k: 'FLEET', seat: 0 }],
						seat: 'SELF',
						filter: { suits: ['SHIP'] },
					},
				},
			},
			ID('st'),
			0,
		)
		const choice = out.pendingChoice
		if (choice === null) throw new Error('expected a pending choice')
		expect(choice.seat).toBe(1)
	})

	it('an entirely unresolvable forced effect is ignored, not an error', () => {
		// The opponent has NO dismissible ships → DISMISS cannot resolve → the
		// forced effect is skipped silently and the operation completes cleanly.
		let s = fresh()
		s = place(s, 'threat', ID('th'), { k: 'HAND', seat: 0 }, 0)
		const out = play(s, ID('th'))
		expect(out.pendingChoice).toBeNull()
		expect(out.stack).toHaveLength(0)
		const skipped = out.log.filter((l) => l.kind === 'SKIPPED')
		expect(skipped.length).toBeGreaterThanOrEqual(1)
		expect(skipped.some((l) => l.message.includes('DISMISS'))).toBe(true)
	})
})
