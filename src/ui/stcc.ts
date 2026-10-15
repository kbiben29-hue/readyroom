// Browser-side access to the fetched STCC card database (src/data/stcc.ts).
//
// Vite bundles vendor/stcc/*.json when it exists (after `npm run fetch-cards`);
// when it doesn't, the glob is empty and every lookup returns null, so the UI
// falls back to its text faces. Tests start with an empty index for
// determinism and inject one through `setStccIndex`.

import { setCardNameIndex } from '../data/cardNames'
import type { CardDef } from '../data/schema'
import {
	STCC_BOXES,
	buildStccIndex,
	normalizeCardNumber,
	type StccBox,
	type StccCard,
} from '../data/stcc'

const modules: Record<string, unknown> =
	import.meta.env.MODE === 'test'
		? {}
		: import.meta.glob('../../vendor/stcc/*.json', {
				eager: true,
				import: 'default',
			})

function fromModules(): Map<string, StccCard> {
	const boxes: Partial<Record<StccBox, unknown>> = {}
	for (const box of STCC_BOXES) {
		const key = `../../vendor/stcc/${box}.json`
		if (key in modules) boxes[box] = modules[key]
	}
	return buildStccIndex(boxes, `${import.meta.env.BASE_URL}stcc`)
}

let index: Map<string, StccCard> = fromModules()
setCardNameIndex(index)

/** "group/name" → path under /stcc/, written by the fetch script. */
let icons: Record<string, string> =
	(modules['../../vendor/stcc/icons.json'] as
		Record<string, string> | undefined) ?? {}

/** Test seam: replace the index (pass an empty Map to clear it). */
export function setStccIndex(
	next: Map<string, StccCard>,
	nextIcons: Record<string, string> = {},
): void {
	index = next
	icons = nextIcons
	setCardNameIndex(next)
}

export function stccCard(def: Pick<CardDef, 'cardId'>): StccCard | null {
	if (def.cardId === null) return null
	return index.get(normalizeCardNumber(def.cardId)) ?? null
}

/** The card scan URL for a def, or null (no fetched data / no scan). */
export function cardImageUrl(def: Pick<CardDef, 'cardId'>): string | null {
	return stccCard(def)?.image ?? null
}

/** Public URL of a fetched cardface icon, e.g. `stccIconUrl('token/dilithium')`, or null. */
export function stccIconUrl(key: string): string | null {
	const path = icons[key]
	return path === undefined ? null : `${import.meta.env.BASE_URL}stcc/${path}`
}

// ---------------------------------------------------------------------------
// [[token]] → icon + label
// ---------------------------------------------------------------------------

export interface TokenView {
	/** Icon key into the fetched icon set ("token/dilithium"), if one exists. */
	icon: string | null
	label: string
	/** icon: glyph only (resources); chip: icon + label (suits, traits, thresholds). */
	kind: 'icon' | 'chip'
}

const SPEC: Record<string, string> = {
	inf: 'influence',
	res: 'research',
	mil: 'military',
	wild: 'any',
}

const TOKEN_ICON: Record<string, [string, string]> = {
	dilithium: ['token/dilithium', 'Dilithium'],
	latinum: ['token/latinum', 'Latinum'],
	glory: ['token/glory-token', 'Glory'],
	action: ['token/action', 'Action'],
	'away team': ['token/away-team', 'Away Team'],
	treachery: ['token/treachery', 'Treachery'],
	collective: ['token/borg-collective', 'Collective'],
	drone: ['token/borg-drone', 'Drone'],
	research: ['skill/research', 'Research'],
	influence: ['skill/influence', 'Influence'],
	military: ['skill/military', 'Military'],
}

const SUITS = new Set([
	'ally',
	'captain',
	'cargo',
	'directive',
	'encounter',
	'incident',
	'location',
	'person',
	'ship',
	'mission',
])

/** How to draw one `[[name]]` token from their rules text. */
export function tokenView(name: string): TokenView {
	const known = TOKEN_ICON[name]
	if (known !== undefined)
		return { icon: known[0], label: known[1], kind: 'icon' }
	if (SUITS.has(name))
		return {
			icon: stccIconUrl(`suit/${name}`) ? `suit/${name}` : `suitFont/${name}`,
			label: name.toUpperCase(),
			kind: 'chip',
		}
	let m = /^(-?\d+|\?)vp$/.exec(name)
	if (m) return { icon: 'token/vp', label: `${m[1]} VP`, kind: 'chip' }
	m = /^(inf|res|mil|wild)-(skill|focus|restriction)$/.exec(name)
	if (m) {
		const spec = SPEC[m[1] ?? ''] ?? 'any'
		const group = m[2] === 'focus' ? 'focus' : 'skill'
		return { icon: `${group}/${spec}`, label: `${spec} ${m[2]}`, kind: 'icon' }
	}
	m = /^(inf|res|mil)(\d+)$/.exec(name)
	if (m)
		return {
			icon: `skill/${SPEC[m[1] ?? ''] ?? 'any'}`,
			label: `${m[2]}+`,
			kind: 'chip',
		}
	const trait = name.replace(/\s+/g, '-')
	return { icon: `trait/${trait}`, label: name.toUpperCase(), kind: 'chip' }
}
