// The game's own icons for the Shorthand glyphs that have a printed
// counterpart: the resource and action tokens, VP, the Away Team, ATTACK, the
// skill and focus icons and the card suits. They come from the fetched STCC
// icon set (public/stcc/icons, src/ui/stcc.ts), which the game needs to run.
//
// The printed tokens and skill/focus icons are full colour, so they are shown
// as images. The suit icons are single-colour shapes, so they are used as a
// mask over the suit's colour. Every other glyph (and every glyph in tests,
// which run without the icon set) is drawn from src/ui/shorthandGlyphs.ts.

import type { Suit } from '../data/ids'
import type { GlyphId } from '../engine/shorthand'
import { stccIconUrl } from './stcc'

/** How a specialty glyph is printed: a skill icon, a focus icon, or the
 *  variable skill icon. */
export type SpecialtyAs = 'skill' | 'focus' | 'variable'

const TOKEN: Partial<Record<GlyphId, string>> = {
	DIL: 'token/dilithium',
	LAT: 'token/latinum',
	GLO: 'token/glory-token',
	ACT: 'token/action',
	VP: 'token/vp',
	AWAY: 'token/away-team',
	ATTACK: 'traitChip/attack',
}

const SPECIALTY: Partial<Record<GlyphId, string>> = {
	RESEARCH: 'research',
	INFLUENCE: 'influence',
	MILITARY: 'military',
	ANY_SPECIALTY: 'any',
}

/** The printed icon for a glyph, or null to draw our own. A specialty glyph
 *  is a skill icon unless `as` says otherwise. */
export function printedGlyphUrl(
	g: GlyphId,
	as: SpecialtyAs = 'skill',
): string | null {
	const token = TOKEN[g]
	if (token !== undefined) return stccIconUrl(token)
	const spec = SPECIALTY[g]
	if (spec === undefined) return null
	if (as === 'variable') return stccIconUrl('skill/variable')
	return stccIconUrl(`${as}/${spec}`)
}

/** The printed suit shape (a mask), or null to draw our own. */
export function printedSuitUrl(suit: Suit | 'ANY'): string | null {
	if (suit === 'ANY') return null
	const s = suit.toLowerCase()
	return stccIconUrl(`suit/${s}`) ?? stccIconUrl(`suitFont/${s}`)
}
