// Card names come from the STCC index only; without one they fall back to the
// card number. Fixture names are invented.

import { afterEach, describe, expect, it } from 'vitest'
import {
	cardName,
	cardNameById,
	cardToken,
	deckLabel,
	missionTitle,
	setCardNameIndex,
	withCardNames,
} from './cardNames'
import { buildStccIndex } from './stcc'

const rec = (card_number: string, name: string) => ({
	id: card_number,
	name,
	suit: 'Person',
	source: 'Test',
	game_box: 'Test',
	card_number,
})

const index = () =>
	buildStccIndex({
		box1: [
			rec('1PIC01/24', 'Captain Alpha'),
			rec('1PER02/25', 'Person Beta'),
			rec('1PIC/M1', 'Mission Gamma'),
		],
	})

afterEach(() => setCardNameIndex(new Map()))

describe('card names', () => {
	it('reads names from the installed STCC index', () => {
		setCardNameIndex(index())
		expect(cardName({ id: '1PER02-25', cardId: '1PER02/25' })).toBe(
			'Person Beta',
		)
		expect(cardNameById('1PER02-25')).toBe('Person Beta')
		expect(deckLabel('PIC')).toBe('Captain Alpha')
		expect(missionTitle({ index: 0, cardId: '1PIC/M1' })).toBe('Mission Gamma')
	})

	it('falls back to the card number, then the def name / id', () => {
		expect(cardName({ id: '1PER02-25', cardId: '1PER02/25' })).toBe('1PER02/25')
		expect(cardName({ id: 'sd-01', cardId: null, name: '2-PLAYER' })).toBe(
			'2-PLAYER',
		)
		expect(cardName({ id: 'fixture', cardId: null })).toBe('fixture')
		expect(cardName(undefined)).toBeUndefined()
		expect(cardNameById('1PER02-25')).toBe('1PER02/25')
		expect(cardNameById('fixture')).toBe('fixture')
		expect(deckLabel('PIC')).toBe('PIC')
		expect(missionTitle({ index: 1 })).toBe('Mission 2')
	})

	it('expands [[card:<def id>]] tokens in text', () => {
		const text = `Free play ${cardToken('1PER02-25')}: which?`
		expect(withCardNames(text)).toBe('Free play 1PER02/25: which?')
		setCardNameIndex(index())
		expect(withCardNames(text)).toBe('Free play Person Beta: which?')
		expect(withCardNames('[[latinum]] stays')).toBe('[[latinum]] stays')
	})
})
