// Browser-side catalog loader (todo/14 — the critical browser-loading wrinkle).
//
// The engine's `loadCatalog()` walks the filesystem with node:fs globs, which
// cannot run in the browser. This module builds the *same* `CardCatalog` shape
// (docs/architecture.md §2, src/engine/setup.ts) from the JSON modules that
// Vite statically bundles via `import.meta.glob`, so the UI can hand it to
// `setup(config, catalog)` exactly like the Node loader does.
//
// Both loaders parse the same Zod schemas (CardArraySchema / BoardArraySchema)
// and build the Stardate specs through the same src/data/stardate module, so
// the two paths cannot drift: a card that validates at build time is identical
// in the browser.

import type { CardCatalog } from '../engine/setup'
import type { CardDef } from '../data/schema'
import { CardArraySchema } from '../data/schema'
import { BoardArraySchema, addBoardSides } from '../data/boards'
import type { DeckId } from '../data/ids'
import { stardateSpecs } from '../data/stardate'
import { inBox, type Expansion, type GameBox } from '../data/boxes'

/** Vite's static glob — keyed by import path, eager so the values are plain
 *  JSON (parsed already). Only `.json` card/board files match; `.gitkeep` is
 *  ignored by the extension rule. */
const modules = import.meta.glob('../data/cards/**/*.json', {
	eager: true,
	import: 'default',
})

function isBoardPath(key: string): boolean {
	return key.includes('/boards/')
}

/** The one Stardate deck file — parsed as CardDefs, wrapped into StardateSpecs
 *  exactly like the Node loader (todo/12 pass 3). */
function isStardatePath(key: string): boolean {
	return key.includes('/common/stardate.json')
}

/** Load every card JSON into a `CardCatalog`. Throws on a schema violation,
 *  like the Node loader. */
export function loadBrowserCatalog(): CardCatalog {
	const defs: CardDef[] = []
	const stardates: CardCatalog['stardates'] = []
	const boards: CardCatalog['boards'] = {}
	const errors: string[] = []

	for (const [key, raw] of Object.entries(modules)) {
		if (isBoardPath(key)) continue // boards are not cards (todo/13)
		if (isStardatePath(key)) {
			const parsed = CardArraySchema.safeParse(raw)
			if (!parsed.success) {
				errors.push(
					`schema violation in ${key}: ${parsed.error.issues.length} issue(s) — ${
						parsed.error.issues[0]?.path.join('.') ?? ''
					}`,
				)
				continue
			}
			try {
				stardates.push(...stardateSpecs(parsed.data))
			} catch (err) {
				errors.push(`${key}: ${(err as Error).message}`)
			}
			continue
		}

		const parsed = CardArraySchema.safeParse(raw)
		if (!parsed.success) {
			errors.push(
				`schema violation in ${key}: ${parsed.error.issues.length} issue(s) — ${
					parsed.error.issues[0]?.path.join('.') ?? ''
				}`,
			)
			continue
		}
		defs.push(...parsed.data)
	}

	// Crew boards — keyed by deck, missions flattened into vp-less MissionState
	// exactly like the Node loader.
	for (const [key, raw] of Object.entries(modules)) {
		if (!isBoardPath(key)) continue
		const parsed = BoardArraySchema.safeParse(raw)
		if (!parsed.success) {
			errors.push(
				`board schema violation in ${key}: ${parsed.error.issues.length} issue(s) — ${
					parsed.error.issues[0]?.path.join('.') ?? ''
				}`,
			)
			continue
		}
		addBoardSides(boards, parsed.data)
	}

	if (errors.length > 0) {
		throw new Error(
			`browser catalog load failed (${errors.length} file(s)):\n  ${errors.join('\n  ')}`,
		)
	}
	return { defs, stardates, boards }
}

/** The crew decks that actually have cards on disk right now (PIC/SHR/
 *  KOL are built; SIS/SEL/BUR land with later todo passes). The deck
 *  picker only offers these. */
export function availableDecks(
	catalog: CardCatalog,
	box?: GameBox,
	expansions: readonly Expansion[] = [],
): DeckId[] {
	const decks = new Set<DeckId>()
	for (const def of catalog.defs) {
		if (def.deck === 'COMMON' || def.deck === undefined) continue
		// a crew deck belongs to the box its printed numbers carry (2GEO… = TBG,
		// 3PIK… = Second Contact, playable with either base box)
		if (
			box !== undefined &&
			def.cardId !== null &&
			!inBox(def, box, expansions)
		)
			continue
		decks.add(def.deck)
	}
	return [...decks].sort((a, b) => a.localeCompare(b))
}

/** A box is playable once it has two crew decks and its own Market. */
export function boxPlayable(catalog: CardCatalog, box: GameBox): boolean {
	const commons = catalog.defs.filter(
		(d) => d.deck === 'COMMON' && d.cardId !== null && inBox(d, box),
	)
	return availableDecks(catalog, box).length >= 2 && commons.length > 0
}
