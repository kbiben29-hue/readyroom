// Crew board data model (todo/13: "Crew boards are not cards"). One board side
// per deck carries the 3 Specialty tracks with their VP-multiplier steps and
// the missions offered on that side (Basic = 1 mission with 0 VP; Advanced = 3
// missions with printed VP — rules/07 §7.1.4 / §7.4.1).
//
// This is a separate data file (NOT card JSON): mission `goal`/`reward` are
// `Predicate`/`Effect` trees like card effects, but a board is not a card and
// cannot be played/gained, so the static `CardDefSchema` has no home for it
// (docs/data-model.md §1 collision note). `loadCatalog()` parses these files
// into `CardCatalog.boards` keyed by deck (src/data/catalog.ts); the goal and
// reward trees round-trip under the exact same grammar as card effects because
// the schemas below reuse schema.ts's PredicateSchema / EffectSchema.

import { z } from 'zod'

import type { Predicate } from '../engine/resolver/queries'
import type { Effect } from '../engine/resolver/nodes'
import { DECKS, type DeckId, type SpecialtyId } from './ids'
import { EffectSchema, PredicateSchema } from './schema'
import type { BoardMissions } from '../engine/setup'
import type { MissionState, TrackTable } from '../engine/state'

export interface TrackMultiplier {
	step: number // Specialty-track step that carries the multiplier
	value: number // ×N at that step
}

export interface CrewBoardTrack {
	specialty: SpecialtyId
	multipliers: TrackMultiplier[]
}

export interface CrewBoardMission {
	index: 0 | 1 | 2
	/** the STCC mission record (`1PIC/M1` …): crosscheck compares name + vp
	 *  against it and counts it as implemented; the UI shows its text */
	cardId?: string | undefined
	goal: Predicate
	reward: Effect
	/** "Attack Reward" (1KOL/M3): the reward resolves as an ATTACK */
	isAttack?: boolean | undefined
	vp: number
}

export interface CrewBoardSide {
	deck: DeckId
	side: 'BASIC' | 'ADVANCED'
	tracks: CrewBoardTrack[]
	missions: CrewBoardMission[]
}

const MissionSchema = z
	.object({
		index: z.union([z.literal(0), z.literal(1), z.literal(2)]),
		cardId: z
			.string()
			.regex(/^\d[A-Z]{3}\/M[1-3]$/)
			.optional(),
		goal: PredicateSchema,
		reward: EffectSchema,
		isAttack: z.boolean().optional(),
		vp: z.number().int(),
	})
	.strict()

export const BoardArraySchema: z.ZodType<CrewBoardSide[]> = z.array(
	z
		.object({
			deck: z.enum(DECKS),
			side: z.enum(['BASIC', 'ADVANCED']),
			tracks: z.array(
				z
					.object({
						specialty: z.enum(['RESEARCH', 'INFLUENCE', 'MILITARY']),
						multipliers: z.array(
							z
								.object({
									step: z.number().int().min(0).max(15),
									value: z.number().int().min(1),
								})
								.strict(),
						),
					})
					.strict(),
			),
			missions: z.array(MissionSchema),
		})
		.strict(),
)

export type { DeckId, SpecialtyId }

const emptyTable = (): TrackTable => ({
	RESEARCH: [],
	INFLUENCE: [],
	MILITARY: [],
})

/** A board side's tracks as the engine's per-specialty glyph table. */
function trackTable(side: CrewBoardSide): TrackTable {
	const table = emptyTable()
	for (const t of side.tracks)
		table[t.specialty] = t.multipliers.map((m) => ({ ...m }))
	return table
}

/** Fold parsed board sides into the catalog's per-deck `BoardMissions`
 *  (missions deep-cloned so no two missions alias one tree —
 *  assertSerialisable treats shared refs as a serialisation cycle). Shared by
 *  the Node loader (catalog.ts) and the browser loader (ui/browserCatalog.ts). */
export function addBoardSides(
	boards: Partial<Record<DeckId, BoardMissions>>,
	sides: readonly CrewBoardSide[],
): void {
	for (const side of sides) {
		const slot = side.side === 'BASIC' ? 'basic' : 'advanced'
		const entry =
			boards[side.deck] ?? (boards[side.deck] = { basic: [], advanced: [] })
		entry[slot] = side.missions.map((m): MissionState => ({
			index: m.index,
			goal: structuredClone(m.goal),
			reward: structuredClone(m.reward),
			vp: m.vp,
			completed: false,
			...(m.cardId !== undefined ? { cardId: m.cardId } : {}),
			...(m.isAttack === true ? { isAttack: true } : {}),
		}))
		entry.tracks = {
			...(entry.tracks ?? { basic: emptyTable(), advanced: emptyTable() }),
			[slot]: trackTable(side),
		}
	}
}
