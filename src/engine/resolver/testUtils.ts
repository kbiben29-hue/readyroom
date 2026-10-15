// Shared test fixtures for the resolver (todo/04). Builds minimal CardDefs
// against the real schema shapes, registers them, and drives operations
// through the stack. The card texts below are SIMPLIFIED transcriptions for
// the rulebook examples — the authoritative texts land with todo/12/13.

import type { CardDef } from '../../data/schema'
import type { SkillIcon } from '../../data/ids'
import type { DeckId, MarketSuit, Suit, TraitId } from '../../data/ids'
import type { Effect, Operation } from './nodes'
import { registerCards } from '../cards'
import {
	addCard,
	newGameState,
	type Frame,
	type GameState,
	type JsonValue,
	type EffectCtx,
	type TrackTable,
} from '../state'
import { run } from './stack'
import type { CardInstanceId } from '../ids'
import type { Seat, ZoneRef } from './queries'

export function op(
	type: Operation['type'],
	effect: Effect,
	extra?: Partial<
		Pick<Operation, 'costsAction' | 'isAttack' | 'requires' | 'trigger'>
	>,
): Operation {
	return {
		type,
		costsAction: extra?.costsAction ?? false,
		isAttack: extra?.isAttack ?? false,
		requires: extra?.requires,
		trigger: extra?.trigger,
		effect,
		text: 'test op',
	}
}

export interface DefSpec {
	id: string
	name?: string | undefined
	suit: Suit
	deck?: DeckId | undefined
	traits?: TraitId[] | undefined
	skills?: SkillIcon[] | undefined
	operations: Operation[]
	developmentCost?: Effect | null | undefined
	vp?: number | undefined
	passives?: string[] | undefined
}

export function makeDef(spec: DefSpec): CardDef {
	return {
		id: spec.id,
		cardId: null,
		name: spec.name ?? spec.id,
		suit: spec.suit,
		deck: spec.deck ?? 'COMMON',
		traits: spec.traits ?? [],
		skills: spec.skills ?? [],
		variableSkill: undefined,
		focus: null,
		vp: spec.vp ?? 0,
		vpAsterisk: false,
		startPosition: null,
		developmentCost:
			spec.developmentCost === undefined ? null : spec.developmentCost,
		operations: spec.operations,
		...(spec.passives !== undefined ? { passives: spec.passives } : {}),
	}
}

export function register(defs: CardDef[]): void {
	registerCards(defs)
}

/** Fresh minimal state (p0/p1, ACTION phase). */
export function fresh(seed = 1): GameState {
	return newGameState(seed)
}

export function place(
	state: GameState,
	defId: string,
	iid: CardInstanceId,
	zone: ZoneRef,
	owner: Seat | null = null,
	extra?: Partial<GameState['cards'][string]>,
): GameState {
	let next = addCard(state, iid, defId, owner, zone)
	if (extra !== undefined) {
		const card = next.cards[iid]!
		next = { ...next, cards: { ...next.cards, [iid]: { ...card, ...extra } } }
	}
	return next
}

export interface PlayOpts {
	ctx?: {
		actor: Seat
		source: CardInstanceId
		bindings?: Record<string, JsonValue>
	}
	opIndex?: number
}

/** Full EffectCtx builder for tests that need bindings/duplicating set. */
export function makeCtx(
	actor: Seat,
	source: CardInstanceId,
	bindings: Record<string, JsonValue> = {},
	extra?: Partial<EffectCtx>,
): EffectCtx {
	return { actor, source, bindings, ...extra }
}

/** Push + run an operation to completion (or to a pending choice). */
export function play(
	state: GameState,
	card: CardInstanceId,
	opts?: PlayOpts,
): GameState {
	const base = opts?.ctx ?? {
		actor: state.activeSeat,
		source: card,
		bindings: {},
	}
	const ctx: EffectCtx = {
		actor: base.actor,
		source: base.source,
		bindings: base.bindings ?? {},
	}
	const frame: Frame = {
		k: 'OPERATION',
		card,
		opIndex: opts?.opIndex ?? 0,
		ctx,
		phase: 0,
	}
	let s: GameState = { ...state, stack: [...state.stack, frame] }
	s = run(s)
	return s
}

/** helper: run a bare effect with a given actor. */
export function pushAndRun(
	state: GameState,
	node: Effect,
	source: CardInstanceId,
	actor: Seat,
): GameState {
	const frame: Frame = {
		k: 'EFFECT',
		node,
		ctx: { actor, source, bindings: {} },
		ip: 0,
	}
	let s: GameState = { ...state, stack: [...state.stack, frame] }
	s = run(s)
	return s
}

export const ID = (s: string): CardInstanceId => s as CardInstanceId
export type { GameState, Seat, ZoneRef, MarketSuit }

// --- player mutation helpers (provisional states are plain JSON; tests patch
// resources/actions/tracks directly before resolving) ------------------------

export function setResources(
	state: GameState,
	seat: Seat,
	res: 'DIL' | 'LAT' | 'GLO',
	amount: number,
): GameState {
	const players = state.players.map((pl) =>
		pl.seat === seat
			? { ...pl, resources: { ...pl.resources, [res]: amount } }
			: pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return { ...state, players }
}

export function setActions(
	state: GameState,
	seat: Seat,
	available: number,
): GameState {
	const players = state.players.map((pl) =>
		pl.seat === seat ? { ...pl, actions: { ...pl.actions, available } } : pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return { ...state, players }
}

/** A test board's multiplier glyphs: ×2 at 4, ×3 at 8, ×4 at 12 on every
 *  track (fixture values, not a real board — see src/data/cards/boards). */
export const TEST_TRACKS: TrackTable = {
	RESEARCH: [
		{ step: 4, value: 2 },
		{ step: 8, value: 3 },
		{ step: 12, value: 4 },
	],
	INFLUENCE: [
		{ step: 4, value: 2 },
		{ step: 8, value: 3 },
		{ step: 12, value: 4 },
	],
	MILITARY: [
		{ step: 4, value: 2 },
		{ step: 8, value: 3 },
		{ step: 12, value: 4 },
	],
}

/** TEST_TRACKS plus the ×1 glyph a Basic side prints at step 0. */
export const TEST_TRACKS_BASIC: TrackTable = {
	RESEARCH: [{ step: 0, value: 1 }, ...TEST_TRACKS.RESEARCH],
	INFLUENCE: [{ step: 0, value: 1 }, ...TEST_TRACKS.INFLUENCE],
	MILITARY: [{ step: 0, value: 1 }, ...TEST_TRACKS.MILITARY],
}

/** Give `seat` a board side's track multiplier glyphs (scoring reads them). */
export function setTracks(
	state: GameState,
	seat: Seat,
	tracks: TrackTable = TEST_TRACKS,
): GameState {
	const players = state.players.map((pl) =>
		pl.seat === seat ? { ...pl, tracks: structuredClone(tracks) } : pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return { ...state, players }
}

export function setSpecialty(
	state: GameState,
	seat: Seat,
	sp: 'RESEARCH' | 'INFLUENCE' | 'MILITARY',
	value: number,
): GameState {
	const players = state.players.map((pl) =>
		pl.seat === seat
			? { ...pl, specialties: { ...pl.specialties, [sp]: value } }
			: pl,
	) as [GameState['players'][0], GameState['players'][1]]
	return { ...state, players }
}
