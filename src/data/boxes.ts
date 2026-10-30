// Game boxes. Every printed card number starts with its box: 1PER05/25 is the
// original game (box 1), 2PER05/26 and 2GEO01/23 are To Boldly Go (box 2).
// A game is played with one box's common cards (Market, Locations,
// Encounters, Incidents); its crew decks come from the same box.
// Cards without a printed number (Stardate faces, test fixtures) belong to
// every box.

export const GAME_BOXES = ['ORIGINAL', 'TBG'] as const
export type GameBox = (typeof GAME_BOXES)[number]

export const DEFAULT_BOX: GameBox = 'ORIGINAL'

/** The box a printed card number belongs to; null for unnumbered cards. */
export function boxOfCardId(cardId: string | null | undefined): GameBox | null {
	if (cardId === null || cardId === undefined) return null
	if (cardId.startsWith('1')) return 'ORIGINAL'
	if (cardId.startsWith('2')) return 'TBG'
	return null
}

/** Does this card belong to `box`? Unnumbered cards belong to every box. */
export function inBox(
	def: { cardId: string | null },
	box: GameBox,
): boolean {
	const b = boxOfCardId(def.cardId)
	return b === null || b === box
}

/** A box's display name. */
export function boxLabel(box: GameBox): string {
	return box === 'TBG' ? 'To Boldly Go' : 'Captain’s Chair'
}
