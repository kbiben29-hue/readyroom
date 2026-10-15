// Card-def lookup for the UI (todo/14 §2). The engine resolves instance defs
// through its global registry (seeded by setup's registerCards); the UI also
// needs to render *catalog* cards that never entered a game (the Card List
// reference panel), so this builds a Map from the store's catalog. Instances
// whose projected def is the HIDDEN sentinel resolve to null → card back.

import { useMemo } from 'react'
import type { CardDef } from '../data/schema'
import type { CardCatalog } from '../engine/setup'
import { useCatalog, useGameStore } from './store'
import { HIDDEN_DEF } from './projection'

export type { CardDef }

export const HIDDEN = HIDDEN_DEF

export function useDefIndex(): Map<string, CardDef> {
	const catalog = useCatalog()
	return useMemo(
		() => new Map((catalog?.defs ?? []).map((d) => [d.id, d])),
		[catalog],
	)
}

/** Def by catalog id (Card List panel, pending-choice source cards, …). */
export function useDefById(id: string): CardDef | null {
	const index = useDefIndex()
	return useMemo(() => index.get(id) ?? null, [index, id])
}

/** Resolve the def for an instance iid via the projected state's cards map. */
export function useDefForIid(iid: string | null): CardDef | null {
	const index = useDefIndex()
	const projected = useGameStore((s) => s.projected)
	return useMemo(() => {
		if (iid === null) return null
		const defId = projected?.cards[iid]?.def
		if (defId === undefined || defId === HIDDEN_DEF) return null
		return index.get(defId) ?? null
	}, [index, projected, iid])
}

/** Convenience: card defs grouped for tools (decks per suit, etc.). */
export function useCatalogOrNull(): CardCatalog | null {
	return useCatalog()
}
