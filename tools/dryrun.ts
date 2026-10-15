// tools/dryrun.ts <cardId> — the sandbox dry-run (todo/11 §5).
//
// Builds a minimal GameState, places the card in an appropriate zone, resolves
// each operation through the real engine, and prints:
//   - describeOperation(effect) — what the tree *says* it does;
//   - every PendingChoice raised, with its candidates/options (and how the
//     dry-run auto-picks the first legal selection);
//   - the resource/action delta and the movement of cards across zones;
//   - the event log.
//
// The point: an operation whose cost can never be paid, or whose target set is
// always empty, shows up as a FAILED/SKIPPED entry — a transcription error.
// Every PLAY operation is also probed ("canPlay in this constructible state").
//
//   tsx tools/dryrun.ts dry-paydiscard      # demo PAY_THEN → prints a CHOOSE_CARDS choice
//   tsx tools/dryrun.ts dry-payres          # PAY_THEN resource cost, no choice, resource delta
//   tsx tools/dryrun.ts 1SHI12/13           # a real-record scratch transcription
//   tsx tools/dryrun.ts DRYRUN_DEMO_X --implemented tools/scratch/dryrun   # explicit dirs
//
// The scratch demo cards live in tools/scratch/dryrun/ (kept on purpose so the
// DoD example is reproducible) and are loaded automatically alongside
// src/data/cards.

import { resolve } from 'node:path'

import type { CardDef } from '../src/data/schema'
import type { GameState } from '../src/engine/state'
import { newGameState, addCard } from '../src/engine/state'
import { registerCards } from '../src/engine/cards'
import type { Effect } from '../src/engine/resolver/nodes'
import type { PendingChoice } from '../src/engine/resolver/choices'
import { run } from '../src/engine/resolver/stack'
import { probeFirstChoice } from '../src/engine/resolver/choices'
import { probe } from '../src/engine/resolver/probe'
import { describeOperation } from '../src/engine/describe'
import type { CardInstanceId } from '../src/engine/ids'
import type { Seat, ZoneRef } from '../src/engine/resolver/queries'
import { cardDef } from '../src/engine/cards'

import {
	DEFAULT_IMPLEMENTED_DIR,
	SCRATCH_DIR,
	loadImplemented,
	type ImplementedCard,
} from './lib/corpus'
import { cardName } from '../src/data/cardNames'
import { loadStccNode } from './stcc-node'

// ---------------------------------------------------------------------------
// State construction
// ---------------------------------------------------------------------------

const HAND: ZoneRef = { k: 'HAND', seat: 0 }
const FLEET: ZoneRef = { k: 'FLEET', seat: 0 }
const STAGING: ZoneRef = { k: 'STAGING', seat: 0 }
const LOCATION_AREA: ZoneRef = { k: 'LOCATION_AREA', seat: 0 }
const DISCARD: ZoneRef = { k: 'DISCARD', seat: 0 }

function setPlayer(state: GameState, seat: Seat): GameState {
	const players = state.players.map((pl) =>
		pl.seat === seat
			? {
					...pl,
					resources: { DIL: 8, LAT: 8, GLO: 8 },
					actions: { available: 3, spent: 0 },
					specialties: { RESEARCH: 5, INFLUENCE: 5, MILITARY: 5 },
				}
			: pl,
	) as GameState['players']
	return { ...state, players }
}

let mintSeq = 0
function mint(
	state: GameState,
	defId: string,
	owner: Seat | null,
	zone: ZoneRef,
): { state: GameState; iid: CardInstanceId } {
	const iid = `dry#${(mintSeq++).toString().padStart(4, '0')}` as CardInstanceId
	return { state: addCard(state, iid, defId, owner, zone), iid }
}

function effectHas(effect: Effect, k: Effect['k']): boolean {
	if (effect.k === k) return true
	let child: Effect | undefined
	switch (effect.k) {
		case 'SEQ':
			return effect.steps.some((s) => effectHas(s, k))
		case 'MAY':
		case 'OPPONENT':
		case 'FORCE':
			child = effect.body ?? undefined
			break
		case 'IF':
			child = effect.then
			break
		case 'PAY_THEN':
			return effectHas(effect.cost, k) || effectHas(effect.body, k)
		case 'CHOOSE_ONE':
			return effect.options.some((o) => effectHas(o.body, k))
		default:
			return false
	}
	return child !== undefined ? effectHas(child, k) : false
}

function zoneForCard(def: CardDef): ZoneRef {
	let deploys = false
	let inPlayOp = false
	for (const op of def.operations) {
		deploys = deploys || effectHas(op.effect, 'DEPLOY')
		if (
			op.type === 'ACTIVATION' ||
			op.type === 'REACTION' ||
			op.type === 'PASSIVE' ||
			op.type === 'CONTROL'
		) {
			inPlayOp = true
		}
	}
	if (deploys) return STAGING
	if (inPlayOp) {
		if (def.suit === 'LOCATION') return LOCATION_AREA
		if (def.suit === 'SHIP') return FLEET
		return STAGING
	}
	return HAND
}

// ---------------------------------------------------------------------------
// Choice rendering
// ---------------------------------------------------------------------------

function nameOf(state: GameState, iid: CardInstanceId): string {
	const card = state.cards[iid]
	if (card === undefined) return iid
	return `${cardName(cardDef(card.def))} (${iid})`
}

function renderChoice(state: GameState, c: PendingChoice): string[] {
	const lines: string[] = [
		`  choice ${c.k} #${c.id} — seat ${c.seat} — "${c.prompt}"`,
	]
	switch (c.k) {
		case 'CHOOSE_CARDS':
			lines.push(
				`    candidates (${c.candidates.length}, pick ${c.min}..${c.max}): ${c.candidates.map((i) => nameOf(state, i)).join(', ') || '(none)'}`,
			)
			if ((c.disabled ?? []).length > 0) {
				lines.push(
					`    disabled: ${c.disabled!.map((d) => `${nameOf(state, d.iid)} (${d.reason})`).join(', ') || '(none)'}`,
				)
			}
			break
		case 'CHOOSE_OPTION':
			lines.push(
				`    options: ${c.options
					.map(
						(o) =>
							`${o.label}${o.enabled ? '' : ` (disabled${o.reason !== undefined ? `: ${o.reason}` : ''})`}`,
					)
					.join(' | ')}`,
			)
			break
		case 'CHOOSE_LOCATION':
			lines.push(
				`    candidates: ${c.candidates.map((i) => nameOf(state, i)).join(', ') || '(none)'}`,
			)
			break
		case 'CHOOSE_SUIT':
			lines.push(`    suits: ${c.suits.join(', ')}`)
			break
		case 'CHOOSE_TRAIT':
			lines.push(`    traits: ${c.traits.join(', ')}`)
			break
		case 'CHOOSE_WILDCARD_AS':
			lines.push(
				`    card ${nameOf(state, c.card)} as one of: ${c.traits.join(', ')}`,
			)
			break
		default:
			break
	}
	return lines
}

// ---------------------------------------------------------------------------
// Deltas
// ---------------------------------------------------------------------------

interface Snapshot {
	resources: Array<{ DIL: number; LAT: number; GLO: number }>
	actions: number[]
	zones: Map<string, number>
}

function snapshot(state: GameState): Snapshot {
	const zones = new Map<string, number>()
	for (const [key, arr] of Object.entries(state.zones))
		zones.set(key, arr.length)
	return {
		resources: state.players.map((p) => ({ ...p.resources })),
		actions: state.players.map((p) => p.actions.available),
		zones,
	}
}

function fmtDelta(before: Snapshot, after: GameState, seats: Seat[]): string[] {
	const lines: string[] = []
	for (const seat of seats) {
		const a = before.resources[seat]!
		const b = after.players[seat]!.resources
		const diffs = (['DIL', 'LAT', 'GLO'] as const)
			.map(
				(r) =>
					`${r}:${b[r] - a[r] !== 0 ? (b[r] - a[r] > 0 ? '+' : '') + (b[r] - a[r]) : '·'}`,
			)
			.join(' ')
		const act = after.players[seat]!.actions.available - before.actions[seat]!
		lines.push(
			`  seat ${seat} resources [${diffs}] actions ${act !== 0 ? (act > 0 ? `+${act}` : act) : '·'}`,
		)
	}
	const keys = new Set([...before.zones.keys(), ...Object.keys(after.zones)])
	const moved: string[] = []
	for (const key of keys) {
		const d = (after.zones[key]?.length ?? 0) - (before.zones.get(key) ?? 0)
		if (d !== 0) moved.push(`${key}:${d > 0 ? `+${d}` : d}`)
	}
	if (moved.length > 0) lines.push(`  zones [${moved.join(', ')}]`)
	return lines
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Push and resolve an operation, printing every PendingChoice and
 *  auto-picking the first legal selection. */
function resolveOperation(
	state: GameState,
	iid: CardInstanceId,
	opIndex: number,
): GameState {
	let s: GameState = {
		...state,
		stack: [
			...state.stack,
			{
				k: 'OPERATION',
				card: iid,
				opIndex,
				ctx: { actor: 0, source: iid, bindings: {} },
				phase: 0,
			},
		],
	}
	s = run(s)
	while (s.pendingChoice !== null) {
		const choice = s.pendingChoice
		for (const line of renderChoice(s, choice)) console.log(line)
		try {
			s = probeFirstChoice(s)
		} catch (err) {
			console.log(
				`  ⚠ unresolvable: no legal selection — ${(err as Error).message}`,
			)
			return s
		}
		s = run(s)
	}
	return s
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function cardLabel(def: CardDef): string {
	return def.cardId ?? def.id
}

async function main(): Promise<void> {
	await loadStccNode() // card names in the output; card numbers without it
	const args = process.argv.slice(2)
	const cardId = args.find((a) => !a.startsWith('--'))
	if (cardId === undefined) {
		console.log('usage: tsx tools/dryrun.ts <cardId> [--implemented <dir>]')
		console.log(
			'demo cards: dry-payres, dry-paydiscard, dry-reaction-may, 1SHI12/13, 1PER15/25',
		)
		process.exitCode = 1
		return
	}
	const extraDirs: string[] = []
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--implemented') extraDirs.push(args[i + 1] ?? '')
	}

	// load + register
	const dirs = [
		DEFAULT_IMPLEMENTED_DIR,
		resolve(SCRATCH_DIR, 'dryrun'), // dry-run demonstration cards (todo/11 scratch)
		resolve(SCRATCH_DIR, 'implemented'), // real-record scratch transcriptions
		...extraDirs,
	]
	const implemented: ImplementedCard[] = []
	for (const dir of dirs) implemented.push(...(await loadImplemented(dir)))
	const allDefs = implemented.map((c) => c.def)
	registerCards(allDefs)

	const target = implemented.find(({ def }) => {
		const norm = (id: string): string =>
			id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
		return (
			norm(def.id) === norm(cardId) || norm(def.cardId ?? '') === norm(cardId)
		)
	})
	if (target === undefined) {
		console.log(`dryrun: no implemented card matches "${cardId}"`)
		console.log(
			`  available: ${[...new Set(implemented.map((c) => cardLabel(c.def)))].sort().join(', ')}`,
		)
		process.exitCode = 1
		return
	}
	const def = target.def
	console.log(`DRYRUN ${cardLabel(def)} — ${cardName(def)} (${def.suit})`)
	console.log('')

	// build the minimal sandbox state
	let s = setPlayer(newGameState(1), 0)
	s = setPlayer(s, 1)
	const support: Array<{ id: string; zone: ZoneRef }> = [
		{ id: 'dry-support-person', zone: HAND },
		{ id: 'dry-support-cargo-a', zone: HAND },
		{ id: 'dry-support-cargo-b', zone: HAND },
		{ id: 'dry-support-cargo-c', zone: DISCARD },
		{ id: 'dry-support-ship', zone: FLEET },
	]
	for (const sp of support) {
		const sup = implemented.find(({ def: d }) => d.id === sp.id)
		if (sup !== undefined) {
			const r = mint(s, sup.def.id, 0, sp.zone)
			s = r.state
		}
	}
	const placed = mint(s, def.id, 0, zoneForCard(def))
	s = placed.state
	const iid = placed.iid
	console.log(`Placed ${cardName(def)} in ${zoneForCard(def).k ?? '?'}`)
	console.log('')

	for (let opIndex = 0; opIndex < def.operations.length; opIndex++) {
		const op = def.operations[opIndex]!
		console.log(`— op[${opIndex}] ${op.type} —`)
		console.log(`  describe: ${describeOperation(op)}`)
		// probes: canPlay-style check for PLAY operations
		if (op.type === 'PLAY') {
			const playable = probe(s, op.effect, {
				actor: 0,
				source: iid,
				bindings: {},
			})
			console.log(
				`  canPlay(probe): ${playable ? 'OK' : 'FAIL (operation effect cannot fully resolve here)'}`,
			)
		}
		const before = snapshot(s)
		s = resolveOperation(s, iid, opIndex)
		console.log(...fmtDelta(before, s, [0, 1]))
		const entries = s.log.slice()
		const newEntries = entries.filter((e) => e.kind !== 'INFO')
		for (const e of newEntries.slice(-8))
			console.log(
				`  log [${e.kind}${e.seat !== undefined ? ` s${e.seat}` : ''}] ${e.message}`,
			)
		console.log('')
	}
}

if (import.meta.url === `file://${process.argv[1]}`) void main()
