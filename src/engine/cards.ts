// Static card-definition registry (provisional). Adapted from docs/data-model.md
// §1: a CardDef is the static template; a CardInstance is the runtime copy.
//
// The docs model splits defs (static JSON) from instances (state), so defs are
// NOT part of GameState. This module is the provisional seam: setup (todo/06)
// will replace the hand-rolled register with a real boot-time load of the card
// data files. The resolver reads defs here instead of threading a registry
// through every signature.

import type { CardDef } from '../data/schema'

const registry = new Map<string, CardDef>()

/** Register static card defs (tests + setup). Idempotent per id. */
export function registerCards(defs: readonly CardDef[]): void {
	for (const def of defs) registry.set(def.id, def)
}

export function hasCardDef(id: string): boolean {
	return registry.has(id)
}

export function cardDef(id: string): CardDef {
	const def = registry.get(id)
	if (!def)
		throw new Error(
			`no CardDef registered for '${id}' — forgot registerCards()?`,
		)
	return def
}

/** Is this a LOCATION — printed, or a card that counts as one
 *  (1ENC07, `treatedAsLocation`)? */
export function isLocationDef(def: CardDef): boolean {
	return def.suit === 'LOCATION' || def.treatedAsLocation === true
}
