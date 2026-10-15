import { afterEach, describe, expect, it } from 'vitest'
import { printedGlyphUrl, printedSuitUrl } from './printedIcons'
import { setStccIndex } from './stcc'

const ICONS = {
	'token/dilithium': 'icons/token/dilithium.svg',
	'token/action': 'icons/token/action.svg',
	'skill/research': 'icons/skill/research.png',
	'skill/variable': 'icons/skill/variable.png',
	'focus/research': 'icons/focus/research.svg',
	'suit/person': 'icons/suit/person.svg',
	'suitFont/mission': 'icons/suitFont/mission.svg',
}

describe('printed icons for Shorthand glyphs', () => {
	afterEach(() => setStccIndex(new Map()))

	it('draws our own glyphs when no icon set is loaded', () => {
		setStccIndex(new Map())
		expect(printedGlyphUrl('DIL')).toBeNull()
		expect(printedSuitUrl('PERSON')).toBeNull()
	})

	it('maps tokens, specialties and suits onto the icon set', () => {
		setStccIndex(new Map(), ICONS)
		expect(printedGlyphUrl('DIL')).toMatch(
			/stcc\/icons\/token\/dilithium\.svg$/,
		)
		expect(printedGlyphUrl('ACT')).toMatch(/token\/action\.svg$/)
		expect(printedGlyphUrl('RESEARCH')).toMatch(/skill\/research\.png$/)
		expect(printedGlyphUrl('RESEARCH', 'focus')).toMatch(
			/focus\/research\.svg$/,
		)
		expect(printedGlyphUrl('ANY_SPECIALTY', 'variable')).toMatch(
			/skill\/variable\.png$/,
		)
		expect(printedSuitUrl('PERSON')).toMatch(/suit\/person\.svg$/)
		expect(printedSuitUrl('MISSION')).toMatch(/suitFont\/mission\.svg$/)
	})

	it('keeps our drawing for glyphs the game has no icon for', () => {
		setStccIndex(new Map(), ICONS)
		expect(printedGlyphUrl('CARD')).toBeNull()
		expect(printedSuitUrl('ANY')).toBeNull()
	})
})
