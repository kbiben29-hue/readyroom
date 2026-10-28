// MAY prompts say when an optional resource cost would be paid in Glory
// (rules/04 §4.3.2 substitution): "spend 2 {LAT}" with 0 Latinum and 2 Glory
// really spends 2 Glory, which is also 2 VP.

import { describe, expect, it } from 'vitest'
import type { Effect } from '../nodes'
import type { ResourceId } from '../../../data/ids'
import { fresh, pushAndRun, ID, setResources } from '../testUtils'

const mayPay = (res: ResourceId, amount: number): Effect => ({
	k: 'MAY',
	body: {
		k: 'PAY_THEN',
		cost: { k: 'COST_RESOURCE', res, amount },
		body: { k: 'DRAW', count: 1 },
	},
})

const promptWith = (
	res: ResourceId,
	have: number,
	glory: number,
	amount: number,
): string | undefined => {
	let s = setResources(fresh(), 0, res, have)
	s = setResources(s, 0, 'GLO', glory)
	const out = pushAndRun(s, mayPay(res, amount), ID('src'), 0)
	return out.pendingChoice?.k === 'CONFIRM'
		? out.pendingChoice.prompt
		: undefined
}

describe('MAY: Glory substitution in the prompt', () => {
	it('names the Glory when the cost is paid entirely in Glory', () => {
		expect(promptWith('LAT', 0, 2, 2)).toMatch(/\(Paid with 2 \{GLO\}\.\)$/)
	})

	it('counts only the shortfall', () => {
		expect(promptWith('LAT', 1, 2, 2)).toMatch(/\(Paid with 1 \{GLO\}\.\)$/)
		// 1 Glory = 2 Dilithium: 3 DIL owed with 1 in the pool → 1 Glory
		expect(promptWith('DIL', 1, 1, 3)).toMatch(/\(Paid with 1 \{GLO\}\.\)$/)
	})

	it('adds nothing when the native resource covers the cost', () => {
		const prompt = promptWith('LAT', 2, 2, 2)
		expect(prompt).toBeDefined()
		expect(prompt).not.toContain('Paid with')
	})
})
