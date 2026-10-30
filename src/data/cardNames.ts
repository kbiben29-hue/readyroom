// Card names. Our card data references cards by id only; the printed names
// live in the STCC database (src/data/stcc.ts), which each player fetches with
// `npm run fetch-cards`. Loaders inject the index (browser: src/ui/stcc.ts,
// Node: tools/stcc-node.ts); without one every name falls back to the card
// number, so nothing here depends on the fetch having run.
//
// Text produced away from a loaded index (engine prompts, choice labels in the
// card data) names a card with a `[[card:<def id>]]` token; `withCardNames`
// expands it wherever the text is shown.

import type { CardDef } from './schema'
import { normalizeCardNumber, type StccCard } from './stcc'

let index: ReadonlyMap<string, StccCard> = new Map()

/** Install the STCC index names are read from (an empty map clears it). */
export function setCardNameIndex(next: ReadonlyMap<string, StccCard>): void {
	index = next
}

/** Def ids are card numbers with `-` for `/`: `1PER01-25` ↔ `1PER01/25`. */
function cardNumberOf(defId: string): string | null {
	return /^\d[A-Z]{3}\d/.test(defId) ? defId.replace('-', '/') : null
}

/** The printed name of a card number (`1PER01/25`, `1PIC/M1`), or null. */
export function stccName(cardNumber: string): string | null {
	return index.get(normalizeCardNumber(cardNumber))?.name ?? null
}

type Named = Pick<CardDef, 'id' | 'cardId'> & { name?: string | undefined }

/** Display name of a card def: STCC name → the def's own `name` (stardates,
 *  test fixtures) → card number → def id. No def → undefined. */
export function cardName(def: Named): string
export function cardName(def: Named | null | undefined): string | undefined
export function cardName(def: Named | null | undefined): string | undefined {
	if (def === null || def === undefined) return undefined
	return (
		(def.cardId !== null ? stccName(def.cardId) : null) ??
		def.name ??
		def.cardId ??
		def.id
	)
}

/** Display name for a bare def id (a `[[card:…]]` token, a replay log entry). */
export function cardNameById(defId: string): string {
	const number = cardNumberOf(defId)
	return (number !== null ? stccName(number) : null) ?? number ?? defId
}

/** A deck's display label: its captain's name (crew decks print the captain
 *  as card 01: `1PIC01/24`) → the deck code. */
export function deckLabel(deck: string): string {
	// the captain card: 1PIC01/24 (box 1), 2GEO01/23 (To Boldly Go) …
	const captain = new RegExp(`^\\d${deck}01/`)
	for (const [number, card] of index)
		if (captain.test(number)) return card.name
	return deck
}

/** A crew-board mission's title: the STCC `1PIC/M1` record's name → that
 *  number → "Mission N". */
export function missionTitle(m: {
	index: number
	cardId?: string | undefined
}): string {
	if (m.cardId === undefined) return `Mission ${m.index + 1}`
	return stccName(m.cardId) ?? m.cardId
}

const CARD_TOKEN_RE = /\[\[card:([^\]]+)\]\]/g

/** Expand `[[card:<def id>]]` tokens to card names. */
export function withCardNames(text: string): string {
	return text.replace(CARD_TOKEN_RE, (_, id: string) => cardNameById(id))
}

/** `[[card:<def id>]]` — how card data and engine text name a card. */
export function cardToken(defId: string): string {
	return `[[card:${defId}]]`
}
