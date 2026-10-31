// Game boxes. Every printed card number starts with its box: 1PER05/25 is the
// original game (box 1), 2PER05/26 and 2GEO01/23 are To Boldly Go (box 2),
// 3PER01/13 is the Second Contact expansion (box 3).
// A game is played with one base box's common cards (Market, Locations,
// Encounters, Incidents); its crew decks come from the same box. Expansions
// are not standalone: each adds its commons and crews to either base box.
// Cards without a printed number (Stardate faces, test fixtures) belong to
// every box.

export const GAME_BOXES = ['ORIGINAL', 'TBG'] as const
export type GameBox = (typeof GAME_BOXES)[number]

export const DEFAULT_BOX: GameBox = 'ORIGINAL'

/** Expansions that add to either base box (rules: Second Contact "is not a
 *  standalone product"). */
export const EXPANSIONS = ['SECOND_CONTACT'] as const
export type Expansion = (typeof EXPANSIONS)[number]

/** The box a printed card number belongs to; null for unnumbered cards. */
export function boxOfCardId(
	cardId: string | null | undefined,
): GameBox | Expansion | null {
	if (cardId === null || cardId === undefined) return null
	if (cardId.startsWith('1')) return 'ORIGINAL'
	if (cardId.startsWith('2')) return 'TBG'
	if (cardId.startsWith('3')) return 'SECOND_CONTACT'
	return null
}

/** Does this card belong to `box` plus `expansions`? Unnumbered cards belong
 *  to every box. */
export function inBox(
	def: { cardId: string | null },
	box: GameBox,
	expansions: readonly Expansion[] = [],
): boolean {
	const b = boxOfCardId(def.cardId)
	return (
		b === null ||
		b === box ||
		(expansions as readonly string[]).includes(b)
	)
}

/** A box's display name. */
export function boxLabel(box: GameBox): string {
	return box === 'TBG' ? 'To Boldly Go' : 'Captain’s Chair'
}

/** An expansion's display name. */
export function expansionLabel(exp: Expansion): string {
	return exp === 'SECOND_CONTACT' ? 'Second Contact' : exp
}
