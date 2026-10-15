// Test helper: a minimal STCC index for the given defs, each with a scan at
// /stcc/img/box1/<def.id>.jpg and optional rules text.

import type { CardDef } from '../data/schema'
import { normalizeCardNumber, type StccCard, type StccText } from '../data/stcc'

export function fakeStccIndex(
	defs: CardDef[],
	text: Partial<StccText> = {},
): Map<string, StccCard> {
	const index = new Map<string, StccCard>()
	for (const def of defs) {
		if (def.cardId === null) continue
		index.set(normalizeCardNumber(def.cardId), {
			id: def.id,
			name: def.name ?? `Card ${def.id}`,
			suit: def.suit,
			source: def.deck,
			game_box: "Captain's Chair",
			card_number: def.cardId,
			species_traits: [],
			regular_traits: [],
			other_traits: [],
			filename: `${def.id}.jpg`,
			icons: [],
			text: { cost: '', hand: '', table: '', goal: '', reward: '', ...text },
			box: 'box1',
			image: `/stcc/img/box1/${def.id}.jpg`,
		})
	}
	return index
}
