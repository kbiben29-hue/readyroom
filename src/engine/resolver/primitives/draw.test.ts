// Deck cycling (todo/05 §4, rules/04 §4.1, rules/12 §12.22): drawing with an
// empty Draw deck shuffles the Discard into a new Draw deck, auto-enlists the
// top Reserve card into the deck, and — only when Reserve AND Discard are both
// empty — MAY enlist a Development. The Development offer is a real MAY
// (PendingChoice) so the DRAW primitive is a resumable frame.

import { describe, expect, it } from 'vitest'
import { fresh, register, makeDef, place, pushAndRun, ID } from '../testUtils'
import { applyChoice } from '../choices'
import { run } from '../stack'
import { drawCards } from './draw'
import { assertSerialisable } from '../../invariants'
import type { GameState } from '../../state'

function deckState(): GameState {
	register([
		makeDef({ id: 'crew', suit: 'PERSON', operations: [] }),
		makeDef({
			id: 'dev',
			suit: 'DIRECTIVE',
			operations: [],
			developmentCost: null,
		}),
	])
	let s = fresh()
	// Draw deck: 1 card; Reserve: 3 cards (top first)
	s = place(s, 'crew', ID('c0'), { k: 'DRAW', seat: 0 }, 0)
	s = place(s, 'crew', ID('r1'), { k: 'RESERVE', seat: 0 }, 0)
	s = place(s, 'crew', ID('r2'), { k: 'RESERVE', seat: 0 }, 0)
	s = place(s, 'crew', ID('r3'), { k: 'RESERVE', seat: 0 }, 0)
	return s
}

describe('DRAW + deck cycling', () => {
	it('drawing 6 from a 1-card deck with 3 Reserve enlists each Reserve in order, drawn right after', () => {
		const s = deckState()
		const out = pushAndRun(s, { k: 'DRAW', count: 6 }, ID('src'), 0)
		assertSerialisable(out)
		// the only cards available: c0, then one reserve per cycle (3 enlists)
		const hand = out.zones['HAND:0'] ?? []
		expect(hand).toEqual(['c0', 'r1', 'r2', 'r3'])
		expect(out.zones['DRAW:0']).toHaveLength(0)
		expect(out.zones['RESERVE:0']).toHaveLength(0)
		expect(out.stack).toHaveLength(0) // draw completed (no offer needed)
	})

	it('a refill first shuffles the Discard into Draw, then the Reserve card is the new top', () => {
		let s = deckState()
		s = place(s, 'crew', ID('d1'), { k: 'DISCARD', seat: 0 }, 0)
		const out = pushAndRun(s, { k: 'DRAW', count: 2 }, ID('src'), 0)
		const hand = out.zones['HAND:0'] ?? []
		// first draw: c0; then deck empty → shuffle [d1] into Draw, enlist r1 on top
		expect(hand).toEqual(['c0', 'r1'])
		expect(out.zones['DRAW:0']).toContain(ID('d1')) // shuffled discard waits under r1
	})

	it('with an affordable Development the draw halts at a MAY offer (resumable frame)', () => {
		let s = fresh()
		s = place(s, 'dev', ID('dv'), { k: 'DEVELOPMENT', seat: 0 }, 0) // cost null → affordable
		const halted = pushAndRun(s, { k: 'DRAW', count: 1 }, ID('src'), 0)
		assertSerialisable(halted)
		expect(halted.pendingChoice?.k).toBe('CONFIRM')
		expect(halted.zones['HAND:0'] ?? []).toHaveLength(0) // not drawn yet
		// decline → nothing happens, frame pops
		const declined = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: halted.pendingChoice!.id,
				selection: false,
			}),
		)
		expect(declined.pendingChoice).toBeNull()
		expect(declined.zones['HAND:0'] ?? []).toHaveLength(0)
		expect(declined.zones['DEVELOPMENT:0']).toContain(ID('dv'))
		// accept → ENLIST_DEVELOPMENT runs, then the resume frame draws it
		const accepted = run(
			applyChoice(halted, {
				t: 'RESOLVE_CHOICE',
				choiceId: halted.pendingChoice!.id,
				selection: true,
			}),
		)
		expect(accepted.pendingChoice).toBeNull()
		expect(accepted.zones['HAND:0']).toContain(ID('dv'))
		expect(accepted.zones['DEVELOPMENT:0']).not.toContain(ID('dv'))
	})

	it('draw without a refill source simply draws nothing further', () => {
		const s = fresh() // empty deck, empty discard, empty reserve, no developments
		const out = pushAndRun(s, { k: 'DRAW', count: 3 }, ID('src'), 0)
		assertSerialisable(out)
		expect(out.zones['HAND:0'] ?? []).toHaveLength(0)
		expect(out.stack).toHaveLength(0)
	})

	it('drawCards pushes a resumable DRAW frame for the stack machine', () => {
		const s = deckState()
		const scheduled = drawCards(s, 0, 6)
		expect(scheduled.stack).toHaveLength(1)
		expect(scheduled.stack[0]!.k).toBe('EFFECT')
		const out = run(scheduled)
		expect(out.zones['HAND:0'] ?? []).toEqual(['c0', 'r1', 'r2', 'r3'])
	})
})
